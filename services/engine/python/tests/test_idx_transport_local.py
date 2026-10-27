import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from curl_cffi.requests import AsyncSession  # noqa: F401
except ImportError:
    AsyncSession = None

from idx_transport import IDXTransportClient


class Handler(BaseHTTPRequestHandler):
    calls = 0

    def do_GET(self):
        type(self).calls += 1
        if type(self).calls == 1:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"controlled challenge response")
            return
        body = json.dumps({"draw": 1, "recordsTotal": 0, "recordsFiltered": 0, "data": []}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@unittest.skipIf(AsyncSession is None, "install services/engine/python optional dependencies")
class LocalTransportIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_curl_cffi_session_retries_controlled_403_then_parses_json(self):
        Handler.calls = 0
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = IDXTransportClient(f"http://127.0.0.1:{server.server_port}/primary", retry_delay=0, success_delay=0)
            async with client:
                result = await client.fetch_index_summary("2026-01-05")
            self.assertTrue(result["ok"])
            self.assertEqual(result["attempts"], 2)
            self.assertEqual(result["body"]["recordsTotal"], 0)
            self.assertEqual(Handler.calls, 2)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
