import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts import store_deploy as deploy


class StoreDeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.commit = 'a' * 40
        self.tag = 'v0.12.91'

    def fixture(self, store='vscode', metadata=None):
        metadata = metadata or {'version': '0.12.91', 'publisher': 'wayri', 'name': 'kicad-visual-review'}
        package = self.root / deploy.NAMES[store].format(version='0.12.91')
        with zipfile.ZipFile(package, 'w') as archive:
            archive.writestr('extension/package.json' if store == 'vscode' else 'manifest.json', json.dumps(metadata))
        manifest = {'version': '0.12.91', 'tag': self.tag, 'sourceCommit': self.commit,
                    'sourceDirty': False, 'assets': {package.name: deploy.digest(package)}}
        notes = self.root / 'RELEASE-NOTES.md'
        notes.write_text('Audited release notes')
        manifest['assets'][notes.name] = deploy.digest(notes)
        self.manifest(manifest)
        return package, manifest

    def manifest(self, value):
        path = self.root / 'release-manifest.json'
        path.write_text(json.dumps(value))
        (self.root / 'SHA256SUMS.txt').write_text(
            f'{deploy.digest(path)}  release-manifest.json\n' + ''.join(
                f'{v}  {k}\n' for k, v in value['assets'].items()))

    def verify(self, store='vscode', source_sha=''):
        return deploy.verify(self.root, self.tag, self.commit, store, source_sha)

    def test_exact_existing_package(self):
        package, _ = self.fixture()
        self.assertEqual(self.verify()[0], package)

    def test_tampered_bytes_rejected(self):
        package, _ = self.fixture()
        package.write_bytes(package.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            self.verify()

    def test_dirty_source_rejected(self):
        _, manifest = self.fixture()
        manifest['sourceDirty'] = True
        self.manifest(manifest)
        with self.assertRaisesRegex(ValueError, 'provenance mismatch'):
            self.verify()

    def test_tag_commit_mismatch_rejected(self):
        self.fixture()
        self.commit = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'provenance mismatch'):
            self.verify()

    def test_wrong_store_identity_rejected(self):
        self.fixture(metadata={'version': '0.12.91', 'publisher': 'other', 'name': 'kicad-visual-review'})
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.verify()

    def test_wrong_packaged_version_rejected(self):
        self.fixture(metadata={'version': '0.12.90', 'publisher': 'wayri', 'name': 'kicad-visual-review'})
        with self.assertRaisesRegex(ValueError, 'version mismatch'):
            self.verify()

    def test_checksum_path_traversal_rejected(self):
        self.fixture()
        with (self.root / 'SHA256SUMS.txt').open('a') as stream:
            stream.write('a' * 64 + '  ../escape.zip\n')
        with self.assertRaisesRegex(ValueError, 'Malformed'):
            self.verify()

    def test_firefox_requires_exact_source_hash(self):
        self.fixture('firefox', {'version': '0.12.91', 'browser_specific_settings': {'gecko': {'id': deploy.AMO_ID}}})
        (self.root / 'kicad-visual-review-amo-source-0.12.91.zip').write_bytes(b'public source fixture')
        with self.assertRaisesRegex(ValueError, 'source archive'):
            self.verify('firefox', 'b' * 64)
        self.verify('firefox', hashlib.sha256(b'public source fixture').hexdigest())

    def test_unexpected_endpoint_rejected_before_network(self):
        for endpoint in ('https://evil.example/upload', 'http://addons.mozilla.org/api/v5/',
                         'https://addons.mozilla.org@evil.example/'):
            with self.assertRaisesRegex(ValueError, 'Unexpected'):
                deploy.request(endpoint, 'secret')

    def test_tampered_notes_rejected(self):
        self.fixture('firefox', {'version': '0.12.91', 'browser_specific_settings': {'gecko': {'id': deploy.AMO_ID}}})
        source = self.root / 'kicad-visual-review-amo-source-0.12.91.zip'
        source.write_bytes(b'source')
        (self.root / 'RELEASE-NOTES.md').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'notes checksum'):
            self.verify('firefox', deploy.digest(source))

    @patch.object(deploy, 'amo_token', return_value='mock-token')
    def test_existing_amo_version_requires_manual_inspection(self, _token):
        with patch.object(deploy, 'request', return_value={'source': 'retained-source'}) as request:
            with self.assertRaisesRegex(ValueError, 'already exists'):
                deploy.firefox(Path('unused'), Path('unused'), '0.12.91', 'notes', 'tag license')
            self.assertEqual(request.call_count, 1)

    def test_redirect_never_forwards_token(self):
        with self.assertRaisesRegex(ValueError, 'redirect refused'):
            deploy.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example/')

    @patch.dict('os.environ', {'CHROME_PUBLISHER_ID': 'publisher', 'CHROME_CLIENT_ID': 'id',
                             'CHROME_CLIENT_SECRET': 'secret', 'CHROME_REFRESH_TOKEN': 'refresh'})
    def test_pending_chrome_review_blocks_all_mutations(self):
        with patch.object(deploy, 'request', side_effect=[{'access_token': 'token'},
                          {'submittedItemRevisionStatus': {'state': 'PENDING_REVIEW'}}]) as request:
            with self.assertRaisesRegex(ValueError, 'not cancelled'):
                deploy.chrome(Path('unused'), '0.12.91')
            self.assertEqual(request.call_count, 2)

    @patch.dict('os.environ', {'CHROME_PUBLISHER_ID': 'publisher', 'CHROME_CLIENT_ID': 'id',
                             'CHROME_CLIENT_SECRET': 'secret', 'CHROME_REFRESH_TOKEN': 'refresh'})
    def test_failed_upload_does_not_publish(self):
        package, _ = self.fixture('chrome', {'version': '0.12.91'})
        with patch.object(deploy, 'request', side_effect=[{'access_token': 'token'}, {},
                          {'uploadState': 'FAILED'}]) as request:
            with self.assertRaisesRegex(ValueError, 'no publish'):
                deploy.chrome(package, '0.12.91')
            self.assertEqual(request.call_count, 3)

    @patch.dict('os.environ', {'CHROME_PUBLISHER_ID': 'publisher', 'CHROME_CLIENT_ID': 'id',
                             'CHROME_CLIENT_SECRET': 'secret', 'CHROME_REFRESH_TOKEN': 'refresh'})
    @patch.object(deploy.time, 'sleep')
    def test_async_chrome_upload_waits_then_submits_with_review(self, _sleep):
        package, _ = self.fixture('chrome', {'version': '0.12.91'})
        with patch.object(deploy, 'request', side_effect=[{'access_token': 'token'}, {},
                          {'uploadState': 'IN_PROGRESS'}, {'lastAsyncUploadState': 'SUCCEEDED'},
                          {'state': 'PENDING_REVIEW'}]) as request:
            self.assertEqual(deploy.chrome(package, '0.12.91')['state'], 'PENDING_REVIEW')
            policy = json.loads(request.call_args.args[3])
            self.assertFalse(policy['skipReview'])
            self.assertTrue(policy['blockOnWarnings'])

    @patch.object(deploy, 'amo_token', return_value='mock-token')
    def test_amo_submits_original_bytes_source_and_selected_license(self, _token):
        package, _ = self.fixture('firefox', {'version': '0.12.91'})
        source = self.root / 'source.zip'
        source.write_bytes(b'Exact tagged source')
        responses = [RuntimeError('Store HTTP 404; not found'),
                     {'uuid': 'a' * 8 + '-aaaa-aaaa-aaaa-' + 'a' * 12, 'processed': True,
                      'valid': True, 'version': '0.12.91'},
                     {'id': 123}, {},
                     {'id': 123, 'file': {'status': 'unreviewed'}, 'source': 'retained'}]
        with patch.object(deploy, 'request', side_effect=responses) as request:
            result = deploy.firefox(package, source, '0.12.91', 'verified notes', 'tag license')
            self.assertEqual(result['state'], 'unreviewed')
            self.assertIn(package.read_bytes(), request.call_args_list[1].args[3])
            self.assertIn(source.read_bytes(), request.call_args_list[2].args[3])
            metadata = json.loads(request.call_args_list[3].args[3])
            self.assertEqual(metadata['custom_license']['text']['en-US'], 'tag license')


if __name__ == '__main__':
    unittest.main()
