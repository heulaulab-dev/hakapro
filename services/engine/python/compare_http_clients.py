"""Compare clients against an explicitly allowlisted IDX red-team test endpoint."""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
import time
from urllib.parse import urlparse


def authorized(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    allowed = {entry.strip().lower() for entry in os.getenv("IDX_AUTHORIZED_TEST_HOSTS", "").split(",") if entry.strip()}
    return bool(host and host in allowed)


def diagnostics(headers):
    lowered = {key.lower(): value for key, value in headers.items()}
    return {
        "tlsVersion": lowered.get("x-test-tls-version"),
        "httpVersion": lowered.get("x-test-http-version"),
        "ja3": lowered.get("x-test-ja3"),
        "ja4": lowered.get("x-test-ja4"),
        "cfMitigated": lowered.get("cf-mitigated"),
        "cfRay": lowered.get("cf-ray"),
    }


def curl_http_version(value):
    # curl_cffi exposes CURL_HTTP_VERSION_* as integer enum values.
    return {0: None, 1: "HTTP/1.0", 2: "HTTP/1.1", 3: "HTTP/2", 4: "HTTP/2", 5: "HTTP/2", 30: "HTTP/3", 31: "HTTP/3"}.get(value, str(value) if value is not None else None)


def challenge(status, headers, text):
    values = {key.lower(): value for key, value in headers.items()}
    return status in (403, 429, 503) and ("cf-mitigated" in values or "cloudflare" in text[:1000].lower() or status == 403)


def run_requests(url, timeout):
    import requests

    started = time.perf_counter()
    try:
        response = requests.get(url, timeout=timeout)
        elapsed = (time.perf_counter() - started) * 1000
        connection = getattr(response.raw, "_connection", None)
        sock = getattr(connection, "sock", None)
        tls_version = sock.version() if sock and hasattr(sock, "version") else None
        result = {"client": "requests", "status": response.status_code, "latencyMs": round(elapsed, 2), "challenge": challenge(response.status_code, response.headers, response.text), **diagnostics(response.headers)}
        result["httpVersion"] = response.headers.get("x-test-http-version") or ({9: "HTTP/1.0", 10: "HTTP/1.0", 11: "HTTP/1.1", 20: "HTTP/2"}.get(getattr(response.raw, "version", None)))
        result["tlsVersion"] = result["tlsVersion"] or tls_version
        return result
    except Exception as exc:
        return {"client": "requests", "error": type(exc).__name__, "latencyMs": round((time.perf_counter() - started) * 1000, 2)}


def run_httpx(url, timeout):
    import httpx

    started = time.perf_counter()
    try:
        with httpx.Client(http2=True, timeout=timeout) as client:
            response = client.get(url)
            elapsed = (time.perf_counter() - started) * 1000
            stream = response.extensions.get("network_stream")
            ssl_object = stream.get_extra_info("ssl_object") if stream else None
            result = {"client": "httpx", "status": response.status_code, "latencyMs": round(elapsed, 2), "challenge": challenge(response.status_code, response.headers, response.text), **diagnostics(response.headers)}
            result["httpVersion"] = result["httpVersion"] or response.http_version
            result["tlsVersion"] = result["tlsVersion"] or (ssl_object.version() if ssl_object else None)
            return result
    except Exception as exc:
        return {"client": "httpx", "error": type(exc).__name__, "latencyMs": round((time.perf_counter() - started) * 1000, 2)}


def run_curl_cffi(url, timeout, impersonate):
    from curl_cffi import requests

    started = time.perf_counter()
    try:
        response = requests.get(url, impersonate=impersonate, timeout=timeout)
        result = {"client": "curl_cffi", "status": response.status_code, "latencyMs": round((time.perf_counter() - started) * 1000, 2), "challenge": challenge(response.status_code, response.headers, response.text), **diagnostics(response.headers)}
        result["httpVersion"] = result["httpVersion"] or curl_http_version(getattr(response, "http_version", None))
        return result
    except Exception as exc:
        return {"client": "curl_cffi", "error": type(exc).__name__, "latencyMs": round((time.perf_counter() - started) * 1000, 2)}


async def run_browser(url, timeout):
    from playwright.async_api import async_playwright

    started = time.perf_counter()
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            cdp = await page.context.new_cdp_session(page)
            captured = {}
            cdp.on("Network.responseReceived", lambda event: captured.update(event.get("response", {})))
            await cdp.send("Network.enable")
            response = await page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
            headers = await response.all_headers() if response else {}
            details = await response.security_details() if response else None
            body = await response.text() if response else ""
            status = response.status if response else None
            result = {"client": "chromium", "status": status, "latencyMs": round((time.perf_counter() - started) * 1000, 2), "challenge": challenge(status or 0, headers, body), **diagnostics(headers)}
            result["httpVersion"] = result["httpVersion"] or captured.get("protocol")
            result["tlsVersion"] = result["tlsVersion"] or (details.get("protocol") if details else None)
            await browser.close()
            return result
    except Exception as exc:
        return {"client": "chromium", "error": type(exc).__name__, "latencyMs": round((time.perf_counter() - started) * 1000, 2)}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="Full request URL on the authorized test endpoint")
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--impersonate", default="chrome")
    parser.add_argument("--output", help="Optional path to write the JSON comparison record")
    args = parser.parse_args()
    if not authorized(args.url):
        print("Refusing request: add the authorized test hostname to IDX_AUTHORIZED_TEST_HOSTS.", file=sys.stderr)
        return 2
    results = [run_requests(args.url, args.timeout), run_httpx(args.url, args.timeout), run_curl_cffi(args.url, args.timeout, args.impersonate), await run_browser(args.url, args.timeout)]
    report = {"observedAt": datetime.now(timezone.utc).isoformat(), "urlHost": urlparse(args.url).hostname, "results": results}
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as output:
            output.write(rendered + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
