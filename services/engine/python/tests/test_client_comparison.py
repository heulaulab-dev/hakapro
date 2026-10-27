import os
import unittest
from unittest.mock import patch

from compare_http_clients import authorized, curl_http_version, diagnostics


class ComparisonTests(unittest.TestCase):
    def test_refuses_hosts_outside_the_explicit_allowlist(self):
        with patch.dict(os.environ, {"IDX_AUTHORIZED_TEST_HOSTS": "redteam.idx.example,127.0.0.1"}):
            self.assertTrue(authorized("https://redteam.idx.example/path"))
            self.assertFalse(authorized("https://www.idx.co.id/path"))

    def test_normalizes_curl_http_protocol_and_optional_server_diagnostics(self):
        self.assertEqual(curl_http_version(3), "HTTP/2")
        self.assertEqual(curl_http_version(30), "HTTP/3")
        self.assertEqual(diagnostics({"x-test-tls-version": "TLSv1.3", "x-test-ja4": "test-fingerprint"}), {
            "tlsVersion": "TLSv1.3", "httpVersion": None, "ja3": None, "ja4": "test-fingerprint", "cfMitigated": None, "cfRay": None,
        })


if __name__ == "__main__":
    unittest.main()
