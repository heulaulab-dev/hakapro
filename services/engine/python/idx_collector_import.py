"""Send previously collected, authorized IDX summary envelopes to HakaPro.

Input is newline-delimited JSON. Each line has ``{"date":"YYYY-MM-DD","body":{...}}``
where body is the original GetIndexSummary DataTables envelope. This tool does not
fetch IDX; it only transfers collector artifacts to the authenticated engine API.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

REQUIRED_RRG_CODES = frozenset({
    "COMPOSITE", "IDXENERGY", "IDXBASIC", "IDXINDUST", "IDXNONCYC", "IDXCYCLIC",
    "IDXHEALTH", "IDXFINANCE", "IDXPROPERT", "IDXTECHNO", "IDXINFRA", "IDXTRANS",
})
MAX_RECORD_BYTES = 4_000_000
RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})


def validate_record(record: dict[str, Any]) -> None:
    """Reject incomplete or malformed daily envelopes before any network request."""
    if not isinstance(record, dict) or set(record) != {"date", "body"}:
        raise ValueError("record must contain exactly date and body")
    iso_date = record["date"]
    if not isinstance(iso_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", iso_date):
        raise ValueError("date must use YYYY-MM-DD")
    try:
        date.fromisoformat(iso_date)
    except ValueError as exc:
        raise ValueError("date must be a real calendar date") from exc

    body = record["body"]
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        raise ValueError("body must contain the IDX DataTables data array")
    rows = body["data"]
    total = body.get("recordsTotal")
    filtered = body.get("recordsFiltered")
    if not rows or not isinstance(total, int) or isinstance(total, bool) or not isinstance(filtered, int) or isinstance(filtered, bool):
        raise ValueError("body must contain rows and integer DataTables record counts")
    if total != len(rows) or filtered != len(rows):
        raise ValueError("incomplete DataTables envelope: row count does not match its totals")

    codes: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("every data row must be an object")
        code, row_date, close = row.get("IndexCode"), row.get("Date"), row.get("Close")
        if not isinstance(code, str) or not code.strip() or not isinstance(row_date, str) or row_date[:10] != iso_date:
            raise ValueError("each row needs an IndexCode and the requested trading date")
        try:
            date.fromisoformat(row_date[:10])
        except ValueError as exc:
            raise ValueError("row contains an invalid trading date") from exc
        if not isinstance(close, (int, float)) or isinstance(close, bool) or not math.isfinite(close) or close <= 0:
            raise ValueError(f"{code} has a missing or invalid close")
        normalized_code = code.strip().upper()
        if normalized_code in codes:
            raise ValueError(f"duplicate index code: {normalized_code}")
        codes.add(normalized_code)
    missing = sorted(REQUIRED_RRG_CODES - codes)
    if missing:
        raise ValueError(f"incomplete RRG sector coverage: missing {', '.join(missing)}")


def import_record(
    base_url: str,
    token: str,
    record: dict[str, Any],
    *,
    timeout: float = 20,
    max_retries: int = 3,
    retry_delay: float = 1,
) -> dict[str, Any]:
    """POST one raw IDX response envelope through HakaPro's HTTPS admin gateway."""
    validate_record(record)
    if timeout <= 0 or max_retries < 0 or max_retries > 8 or retry_delay < 0 or retry_delay > 60:
        raise ValueError("timeout must be positive, max_retries 0–8, and retry_delay 0–60 seconds")
    target = urlsplit(base_url)
    local_http = target.scheme == "http" and target.hostname in {"127.0.0.1", "localhost", "::1"}
    if (target.scheme != "https" and not local_http) or not target.hostname or target.username or target.password:
        raise ValueError("collector URL must use HTTPS (HTTP is allowed only for localhost testing)")
    payload = json.dumps(record, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_RECORD_BYTES:
        raise ValueError("record exceeds the engine's 4 MB request limit")
    request = Request(
        f"{base_url.rstrip('/')}/api/admin/indices/import",
        data=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(max_retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                result = json.loads(response.read())
                if not isinstance(result, dict):
                    raise RuntimeError("engine returned a non-object response")
                return result
        except HTTPError as exc:
            # Surface bounded response details; authentication failures are never retried.
            detail = exc.read(2048).decode("utf-8", errors="replace")
            if exc.code not in RETRYABLE_STATUSES or attempt == max_retries:
                raise RuntimeError(f"engine import failed with HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            if attempt == max_retries:
                raise RuntimeError(f"engine import connection failed: {exc.reason}") from exc
        time.sleep(retry_delay * (2**attempt))
    raise RuntimeError("engine import exhausted retries")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="NDJSON file with date/body records")
    parser.add_argument("--url", default=os.environ.get("ENGINE_COLLECTOR_URL"), help="HakaPro engine base URL")
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--max-retries", type=int, choices=range(0, 9), default=3, help="bounded retries for transient network/HTTP failures; auth failures are never retried")
    parser.add_argument("--retry-delay", type=float, default=1, help="base exponential-backoff delay in seconds (0–60)")
    args = parser.parse_args(argv)
    token = os.environ.get("ENGINE_ADMIN_TOKEN")
    if not args.url or not token:
        parser.error("--url/ENGINE_COLLECTOR_URL and ENGINE_ADMIN_TOKEN are required")

    imported = 0
    try:
        with args.input.open(encoding="utf-8") as source:
            for line_number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                    if not isinstance(record, dict):
                        raise ValueError("record must be a JSON object")
                    result = import_record(args.url, token, record, timeout=args.timeout, max_retries=args.max_retries, retry_delay=args.retry_delay)
                except (json.JSONDecodeError, ValueError, RuntimeError) as exc:
                    print(f"line {line_number}: {exc}", file=sys.stderr)
                    return 1
                imported += 1
                print(json.dumps(result, separators=(",", ":")))
    except OSError as exc:
        print(f"cannot read input: {exc}", file=sys.stderr)
        return 1

    print(f"imported {imported} collector records", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
