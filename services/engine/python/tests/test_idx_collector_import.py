"""Transport tests for the authorized collector sender (local HTTP only)."""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from idx_collector_import import REQUIRED_RRG_CODES, import_record, validate_record


class ImportHandler(BaseHTTPRequestHandler):
    received = None

    def do_POST(self):  # noqa: N802 - stdlib handler API
        self.__class__.received = {
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
            "body": json.loads(self.rfile.read(int(self.headers["Content-Length"]))),
        }
        body = json.dumps({"data": {"date": "2026-10-26", "received": 1, "rejected": 0, "stored": 1}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class CollectorImportTests(unittest.TestCase):
    @staticmethod
    def complete_record():
        rows = [
            {"IndexCode": code, "Date": "2026-10-26T00:00:00", "Close": 100.0}
            for code in sorted(REQUIRED_RRG_CODES)
        ]
        return {"date": "2026-10-26", "body": {"recordsTotal": len(rows), "recordsFiltered": len(rows), "data": rows}}

    def test_sends_raw_envelope_with_bearer_and_returns_engine_result(self):
        ImportHandler.received = None
        server = ThreadingHTTPServer(("127.0.0.1", 0), ImportHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)

        record = self.complete_record()
        result = import_record(f"http://127.0.0.1:{server.server_port}", "test-token", record)

        self.assertEqual(result["data"]["stored"], 1)
        self.assertEqual(ImportHandler.received["path"], "/api/admin/indices/import")
        self.assertEqual(ImportHandler.received["authorization"], "Bearer test-token")
        self.assertEqual(ImportHandler.received["body"], record)

    def test_rejects_non_local_http_targets(self):
        with self.assertRaisesRegex(ValueError, "must use HTTPS"):
            import_record("http://example.com", "test-token", self.complete_record())

    def test_preflight_rejects_missing_sector_bad_close_and_incomplete_envelope(self):
        record = self.complete_record()
        validate_record(record)

        missing_sector = self.complete_record()
        missing_sector["body"]["data"] = [row for row in missing_sector["body"]["data"] if row["IndexCode"] != "IDXTECHNO"]
        missing_sector["body"]["recordsTotal"] -= 1
        missing_sector["body"]["recordsFiltered"] -= 1
        with self.assertRaisesRegex(ValueError, "IDXTECHNO"):
            validate_record(missing_sector)

        bad_close = self.complete_record()
        bad_close["body"]["data"][0]["Close"] = None
        with self.assertRaisesRegex(ValueError, "invalid close"):
            validate_record(bad_close)

        incomplete = self.complete_record()
        incomplete["body"]["recordsTotal"] += 1
        with self.assertRaisesRegex(ValueError, "incomplete DataTables"):
            validate_record(incomplete)


if __name__ == "__main__":
    unittest.main()
