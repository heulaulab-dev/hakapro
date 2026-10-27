import unittest

from idx_transport import IDXTransportClient


class Response:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.text = "challenge" if status_code == 403 else ""

    def json(self):
        return self._payload


class Session:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.closed = False

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    async def close(self):
        self.closed = True


class IdxTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_formats_date_and_maps_datatables_body(self):
        session = Session([Response(200, {"draw": 1, "recordsTotal": 1, "recordsFiltered": 1, "data": []})])
        client = IDXTransportClient("https://idx-test.example/primary", session_factory=lambda: session, retry_delay=0)
        async with client:
            result = await client.fetch_index_summary("2026-01-05")
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["body"]["recordsTotal"], 1)
        self.assertEqual(session.calls[0][1]["params"], {"date": "20260105", "start": 0, "length": 9999})
        self.assertEqual(session.calls[0][1]["timeout"], 30)
        self.assertEqual(session.calls[0][1]["headers"], {})
        self.assertTrue(session.closed)

    async def test_rotates_impersonation_after_forbidden_then_succeeds(self):
        session = Session([Response(403), Response(200, {"data": []})])
        client = IDXTransportClient("https://idx-test.example/primary", session_factory=lambda: session, retry_delay=0)
        async with client:
            result = await client.fetch_index_summary("2026-01-05")
        self.assertEqual(result["status"], 200)
        self.assertEqual([call[1]["impersonate"] for call in session.calls], ["chrome", "chrome124"])

    async def test_stops_after_bounded_retries(self):
        session = Session([Response(503), Response(503), Response(503)])
        client = IDXTransportClient("https://idx-test.example/primary", session_factory=lambda: session, max_retries=2, retry_delay=0)
        async with client:
            result = await client.fetch_index_summary("2026-01-05")
        self.assertEqual(result["status"], 503)
        self.assertEqual(result["attempts"], 3)

    async def test_does_not_retry_non_retryable_status(self):
        session = Session([Response(404)])
        client = IDXTransportClient("https://idx-test.example/primary", session_factory=lambda: session, retry_delay=0)
        async with client:
            result = await client.fetch_index_summary("2026-01-05")
        self.assertEqual(result["status"], 404)
        self.assertEqual(len(session.calls), 1)

    async def test_retries_timeout_and_returns_after_configured_attempt_limit(self):
        session = Session([TimeoutError(), TimeoutError()])
        client = IDXTransportClient("https://idx-test.example/primary", session_factory=lambda: session, max_retries=1, retry_delay=0)
        async with client:
            result = await client.fetch_index_summary("2026-01-05")
        self.assertEqual(result, {"ok": False, "status": None, "attempts": 2, "error": "TimeoutError"})
        self.assertEqual(len(session.calls), 2)


if __name__ == "__main__":
    unittest.main()
