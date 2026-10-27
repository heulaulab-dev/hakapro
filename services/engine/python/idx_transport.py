"""Educational IDX GetIndexSummary transport, compatible with curl_cffi's AsyncSession API."""

import asyncio
import json
import logging
import random
import re
from datetime import date
from typing import Any, Callable

log = logging.getLogger("hakapro.idx_transport")

RETRYABLE_STATUS = {403, 429, 500, 502, 503, 504}
IMPERSONATION_ROTATION = ("chrome124", "chrome120", "safari18_0", "safari17_0", "edge101", "chrome110")
# Keep curl_cffi's impersonated browser defaults. Coolify's egress received a
# Cloudflare challenge when these application-level headers were forced.
DEFAULT_HEADERS: dict[str, str] = {}


def backoff_seconds(retry: int, *, base: float = 2.0, linear: float = 0.5, jitter: float = 0.25) -> float:
    nominal = base**retry + linear * retry
    return nominal * (1.0 + random.uniform(0, jitter))


class IDXTransportClient:
    """One persistent async session; retries are bounded and all outcomes are structured."""

    def __init__(
        self,
        base_url: str,
        *,
        session_factory: Callable[[], Any] | None = None,
        max_retries: int = 3,
        retry_delay: float | None = None,
        timeout: float = 30,
        impersonate: str = "chrome",
        success_delay: float = 0.2,
    ):
        if not re.match(r"^https?://[^/]+(?:/.*)?$", base_url):
            raise ValueError("base_url must be an absolute HTTP(S) URL")
        if max_retries < 0 or max_retries > 8:
            raise ValueError("max_retries must be between 0 and 8")
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.timeout = timeout
        self.impersonate = impersonate
        self.success_delay = success_delay
        self._session_factory = session_factory
        self._session: Any = None

    async def __aenter__(self):
        if self._session is not None:
            raise RuntimeError("IDX transport session is already open")
        factory = self._session_factory
        if factory is None:
            from curl_cffi.requests import AsyncSession

            factory = lambda: AsyncSession(headers=DEFAULT_HEADERS)
        self._session = factory()
        log.info(json.dumps({"event": "idx_session_open", "host": self.base_url.split("/")[2]}))
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        if self._session is not None:
            await self._session.close()
            self._session = None
            log.info(json.dumps({"event": "idx_session_close"}))

    async def fetch_index_summary(self, iso_date: str) -> dict[str, Any]:
        if self._session is None:
            raise RuntimeError("open IDX transport with 'async with' before requesting")
        try:
            parsed = date.fromisoformat(iso_date)
        except ValueError as exc:
            raise ValueError("iso_date must use YYYY-MM-DD") from exc
        if parsed.isoformat() != iso_date:
            raise ValueError("iso_date must use YYYY-MM-DD")

        url = f"{self.base_url}/TradingSummary/GetIndexSummary"
        params = {"date": parsed.strftime("%Y%m%d"), "start": 0, "length": 9999}
        current_impersonate = self.impersonate
        for retry in range(self.max_retries + 1):
            attempt = retry + 1
            try:
                response = await self._session.get(
                    url,
                    params=params,
                    headers=DEFAULT_HEADERS,
                    impersonate=current_impersonate,
                    timeout=self.timeout,
                )
                status = int(response.status_code)
                headers = getattr(response, "headers", {})
                cf_ray = headers.get("cf-ray")
                cf_mitigated = headers.get("cf-mitigated")
                log.info(json.dumps({"event": "idx_http_response", "status": status, "attempt": attempt, "date": iso_date, "cfRay": cf_ray, "cfMitigated": cf_mitigated}))
                if status == 200:
                    try:
                        body = response.json()
                    except (ValueError, json.JSONDecodeError):
                        return {"ok": False, "status": status, "attempts": attempt, "error": "invalid-json", "cfRay": cf_ray}
                    if self.success_delay:
                        await asyncio.sleep(self.success_delay)
                    return {"ok": True, "status": status, "attempts": attempt, "body": body}
                if status not in RETRYABLE_STATUS or retry == self.max_retries:
                    return {"ok": False, "status": status, "attempts": attempt, "error": "http-status", "cfRay": cf_ray}
                if status == 403:
                    next_profile = IMPERSONATION_ROTATION[retry % len(IMPERSONATION_ROTATION)]
                    log.warning(json.dumps({"event": "idx_retry_impersonation", "status": status, "from": current_impersonate, "to": next_profile, "attempt": attempt}))
                    current_impersonate = next_profile
                delay = self.retry_delay if self.retry_delay is not None else backoff_seconds(retry)
                await asyncio.sleep(delay)
            except Exception as exc:
                if retry == self.max_retries:
                    return {"ok": False, "status": None, "attempts": attempt, "error": type(exc).__name__}
                delay = self.retry_delay if self.retry_delay is not None else backoff_seconds(retry, base=1.0)
                log.warning(json.dumps({"event": "idx_retry_transport_error", "error": type(exc).__name__, "attempt": attempt}))
                await asyncio.sleep(delay)
        raise AssertionError("unreachable")
