import hashlib
import hmac
import http.client
import json
import threading
import unittest
from unittest.mock import patch

import service


class LocalVoiceSecurityTest(unittest.TestCase):
    def setUp(self):
        self.token = 'a' * 64
        self.server = service.make_server(self.token, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, data, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        connection.request('POST', path, json.dumps(data), {'Content-Type': 'application/json', **(headers or {})})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_nonce_proof_without_disclosing_token(self):
        nonce = 'b' * 64
        with patch.object(service.stt, 'status', return_value={}), patch.object(service.tts, 'status', return_value={}), patch.object(service.claude_mcp, 'is_logged_in', return_value=True):
            code, result = self.request('/status', {'nonce': nonce})
        self.assertEqual(code, 200)
        self.assertEqual(result['proof'], hmac.new(self.token.encode(), nonce.encode(), hashlib.sha256).hexdigest())
        self.assertNotIn(self.token, json.dumps(result))

    def test_rejects_unauthorized_origin_and_host(self):
        auth = {'Authorization': 'Bearer ' + self.token}
        self.assertEqual(self.request('/synthesize', {'text': 'test'})[0], 403)
        self.assertEqual(self.request('/synthesize', {'text': 'test'}, {**auth, 'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/status', {'nonce': 'b' * 64}, {'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/status', {'nonce': 'invalid'})[0], 400)
        self.assertEqual(self.request('/synthesize', {'text': 'x' * 601}, auth)[0], 400)


if __name__ == '__main__':
    unittest.main()
