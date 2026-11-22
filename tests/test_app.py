"""Verify GitHub App links, public metadata boundaries, and signed HTTP entry points."""
import hashlib
import hmac
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from kicad_vizdiff.app_review import changed_designs, check_payload, public_designs, public_review, service_origin
from kicad_vizdiff.app_assets import PUBLIC_ASSETS
from kicad_vizdiff.app_server import AppServer, validate_credentials, webhook_secret
from kicad_vizdiff.git import VizError

SHA = 'a' * 40
BASE = 'b' * 40


class AppMetadataTests(unittest.TestCase):
    def test_mounted_webhook_secret_is_bounded_and_unambiguous(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'webhook'
            path.write_bytes(b'strong-mounted-secret-value\n')
            self.assertEqual(webhook_secret({'GITHUB_WEBHOOK_SECRET_FILE': str(path)}), 'strong-mounted-secret-value')
            with self.assertRaises(VizError):
                webhook_secret({'GITHUB_WEBHOOK_SECRET_FILE': str(path), 'GITHUB_WEBHOOK_SECRET': 'other'})
            for value in [b'x' * 4097, b'line\nbreak', b'\xff', b'']:
                path.write_bytes(value)
                with self.assertRaises(VizError):
                    webhook_secret({'GITHUB_WEBHOOK_SECRET_FILE': str(path)})

    def test_suffix_changing_renames_are_added_or_removed(self):
        files = [{'filename': 'board.kicad_pcb', 'previous_filename': 'notes.txt', 'status': 'renamed'},
                 {'filename': 'notes.txt', 'previous_filename': 'old.kicad_sch', 'status': 'renamed'},
                 {'filename': 'new.kicad_sch', 'previous_filename': 'old.kicad_pcb', 'status': 'renamed'}]
        with patch('kicad_vizdiff.app_review.api', return_value=files):
            result = changed_designs('owner/board', 1)
        self.assertEqual(result, [{'file': 'board.kicad_pcb', 'oldFile': 'board.kicad_pcb', 'status': 'added'},
                                  {'file': 'old.kicad_sch', 'oldFile': 'old.kicad_sch', 'status': 'removed'},
                                  {'file': 'old.kicad_pcb', 'oldFile': 'old.kicad_pcb', 'status': 'removed'},
                                  {'file': 'new.kicad_sch', 'oldFile': 'new.kicad_sch', 'status': 'added'}])

    def test_public_credentials_reject_missing_id_or_misplaced_key(self):
        with tempfile.TemporaryDirectory() as temp:
            for app_id, key in ((None, None), ('invalid', 'missing'), ('12', None), ('12', str(Path(temp)/'key.pem'))):
                with self.subTest(app_id=app_id, key=key), self.assertRaises(VizError):
                    validate_credentials(app_id, key, temp)

    def test_review_merge_base_fork_and_rename(self):
        replies = [{'private': False}, {'base': {'sha': SHA}, 'head': {'sha': SHA,
                   'repo': {'full_name': 'fork/board', 'private': False}}},
                   {'merge_base_commit': {'sha': BASE}},
                   [{'filename': 'board.kicad_pcb', 'previous_filename': 'old.kicad_pcb', 'status': 'renamed'}]]
        with patch('kicad_vizdiff.app_review.api', side_effect=replies) as api:
            result = public_review('owner/board', '4')
        self.assertEqual(result['base'], BASE)
        self.assertEqual(result['headRepository'], 'fork/board')
        self.assertEqual(result['files'][0]['oldFile'], 'old.kicad_pcb')
        self.assertIn('refs%2Fpull%2F4%2Fhead', api.call_args_list[2].args[0])

    def test_no_private_repository_access(self):
        with patch('kicad_vizdiff.app_review.api', return_value={'private': True}) as api:
            with self.assertRaises(VizError):
                public_review('owner/board', 1)
            self.assertEqual(api.call_count, 1)

    def test_design_listing_pinned_and_no_silent_truncation(self):
        tree = {'tree': [{'type': 'blob', 'path': 'board.kicad_pcb'},
                         {'type': 'blob', 'path': '../escape.kicad_sch'},
                         {'type': 'blob', 'path': 'readme.md'}]}
        with patch('kicad_vizdiff.app_review.public_commit', return_value=SHA), patch('kicad_vizdiff.app_review.api', return_value=tree) as api:
            result = public_designs('owner/board', 'branch/name')
        self.assertEqual(result['ref'], SHA)
        self.assertEqual(result['files'], ['board.kicad_pcb'])
        self.assertIn(SHA, api.call_args.args[0])
        with patch('kicad_vizdiff.app_review.public_commit', return_value=SHA), patch('kicad_vizdiff.app_review.api', return_value={'truncated': True}):
            with self.assertRaises(VizError):
                public_designs('owner/board', 'main')

    def test_checks_link_to_browser_viewer(self):
        check = check_payload('https://review.example', 'owner/board', 4, SHA, [{}])
        self.assertEqual(check['details_url'], 'https://review.example/app/?repository=owner%2Fboard&pull=4')
        self.assertIn('No browser extension', check['output']['summary'])
        self.assertEqual(check['conclusion'], 'neutral')

    def test_origin_boundary(self):
        self.assertEqual(service_origin('https://review.example/'), 'https://review.example')
        for origin in ('http://review.example', 'https://u:p@review.example', 'https://review.example/path', 'https://review.example?x=1'):
            with self.subTest(origin=origin), self.assertRaises(VizError):
                service_origin(origin)


class AppHTTPTests(unittest.TestCase):
    def test_metadata_budget_rejects_before_github_and_refills(self):
        self.server.metadata_tokens = 0
        with patch('kicad_vizdiff.app_server.public_designs') as lookup:
            self.assertEqual(self.request('/api/designs?repository=owner/repo')[0], 429)
            lookup.assert_not_called()
        self.server.metadata_updated -= 2
        with patch('kicad_vizdiff.app_server.public_designs', return_value={'files': []}):
            self.assertEqual(self.request('/api/designs?repository=owner/repo')[0], 200)

    def test_excess_connections_do_not_spawn_threads(self):
        from unittest.mock import Mock
        request = Mock()
        for _ in range(32):
            self.assertTrue(self.server.request_slots.acquire(blocking=False))
        try:
            with patch.object(self.server, 'shutdown_request') as close, patch('http.server.ThreadingHTTPServer.process_request') as spawn:
                self.server.process_request(request, ('127.0.0.1', 123))
                close.assert_called_once_with(request)
                spawn.assert_not_called()
        finally:
            for _ in range(32):
                self.server.request_slots.release()

    def test_webhook_rejects_chunked_framing(self):
        # The server rejects this framing from the headers alone. Avoid sending
        # body bytes that the server will intentionally leave unread on close.
        request = Request(self.origin + '/api/github/webhook', method='POST',
                          headers={'Transfer-Encoding': 'chunked'})
        with self.assertRaises(HTTPError) as raised:
            urlopen(request, timeout=5)
        with raised.exception as response:
            self.assertEqual(response.code, 400)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / 'index.html').write_text('<h1>Viewer</h1>')
        self.server = AppServer(('127.0.0.1', 0), root, 'http://127.0.0.1:8780', webhook_secret='secret')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server.worker.shutdown(wait=True)
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, body=None, headers=None):
        try:
            response = urlopen(Request(self.origin + path, data=body, headers=headers or {}), timeout=5)
        except HTTPError as response:
            with response:
                return response.code, response.read(), response.headers
        with response:
            return response.status, response.read(), response.headers

    def test_viewer_and_traversal(self):
        status, body, headers = self.request('/app/')
        self.assertEqual(status, 200)
        self.assertIn(b'Viewer', body)
        self.assertIn("script-src 'self'", headers['Content-Security-Policy'])
        self.assertEqual(self.request('/app/%2e%2e/server.py')[0], 404)
        self.assertEqual(self.request('/health')[0], 200)

    def test_secret_files_are_never_public_assets(self):
        for name in ('private.pem', '.env', 'credentials.json'):
            (self.server.web_root / name).write_text('secret')
            self.assertEqual(self.request('/app/'+name)[0], 404)

    def test_owned_renderer_assets_are_public_but_kicanvas_is_not(self):
        self.assertIn('owned-canvas.js', PUBLIC_ASSETS)
        self.assertIn('schematic-renderer.js', PUBLIC_ASSETS)
        self.assertIn('pcb-renderer.js', PUBLIC_ASSETS)
        self.assertNotIn('vendor/kicanvas.js', PUBLIC_ASSETS)
        (self.server.web_root / 'owned-canvas.js').write_text('owned')
        vendor = self.server.web_root / 'vendor'
        vendor.mkdir()
        (vendor / 'kicanvas.js').write_text('old renderer')
        self.assertEqual(self.request('/app/owned-canvas.js')[0], 200)
        self.assertEqual(self.request('/app/vendor/kicanvas.js')[0], 404)

    def test_unhealthy_worker_fails_health_and_webhook_acknowledgement(self):
        self.server.worker.failed.set()
        self.assertEqual(self.request('/health')[0], 503)
        raw = json.dumps({'action': 'opened', 'repository': {'private': False}}).encode()
        headers = {'X-Hub-Signature-256': 'sha256=' + hmac.new(b'secret', raw, hashlib.sha256).hexdigest(),
                   'X-GitHub-Event': 'pull_request', 'X-GitHub-Delivery': 'unhealthy'}
        self.assertEqual(self.request('/api/github/webhook', raw, headers)[0], 503)

    def test_signed_webhook_and_duplicate(self):
        raw = json.dumps({'action': 'opened', 'repository': {'private': False}}).encode()
        done = threading.Event()
        self.server.process_pr = lambda payload: done.set()
        headers = {'X-Hub-Signature-256': 'sha256=' + hmac.new(b'secret', raw, hashlib.sha256).hexdigest(),
                   'X-GitHub-Event': 'pull_request', 'X-GitHub-Delivery': 'delivery-1'}
        self.assertEqual(self.request('/api/github/webhook', raw)[0], 401)
        self.assertEqual(self.request('/api/github/webhook', raw, headers)[0], 202)
        self.assertTrue(done.wait(2))
        body = json.loads(self.request('/api/github/webhook', raw, headers)[1])
        self.assertEqual(body['status'], 'duplicate')
        headers['X-GitHub-Delivery'] = 'forged-new-delivery-id'
        self.assertEqual(json.loads(self.request('/api/github/webhook', raw, headers)[1])['status'], 'duplicate')

    def test_database_cannot_be_served_as_viewer_asset(self):
        with self.assertRaises(VizError):
            AppServer(('127.0.0.1', 0), self.server.web_root, self.server.origin,
                      state_path=self.server.web_root / 'state.sqlite3')

    def test_check_redelivery_updates_same_app_check(self):
        payload = {'repository': {'full_name': 'owner/board'}, 'pull_request': {'number': 4, 'head': {'sha': SHA}}, 'installation': {'id': 1}}
        check = check_payload(self.server.origin, 'owner/board', 4, SHA, [{}])
        existing = {'check_runs': [{'id': 8, 'external_id': check['external_id'], 'app': {'id': 10}}]}
        first_page = {'check_runs': [{'id': i, 'app': {'id': 99}} for i in range(100)]}
        with patch.dict('os.environ', {'GITHUB_APP_ID': '10', 'GITHUB_PRIVATE_KEY_PATH': 'unused'}), patch('kicad_vizdiff.app_server.public_repository', return_value='owner/board'), patch('kicad_vizdiff.app_server.changed_designs', return_value=[{}]), patch('kicad_vizdiff.app_server.installation_token', return_value='server-only-token'), patch('kicad_vizdiff.app_server.api', side_effect=[first_page, existing, {}]) as api:
            self.server.process_pr(payload)
        self.assertIn('page=2', api.call_args_list[1].args[0])
        self.assertEqual(api.call_args.kwargs['method'], 'PATCH')
        self.assertNotIn('head_sha', api.call_args.args[2])
        self.assertEqual(api.call_args.args[0], '/repos/owner/board/check-runs/8')


if __name__ == '__main__':
    unittest.main()
