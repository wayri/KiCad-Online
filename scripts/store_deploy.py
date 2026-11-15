"""Verify existing release bytes, then explicitly submit them to a store.

No builds, archive extraction, deletion, review cancellation, or automatic retries
of mutations. Credentials are read from the environment and never written to receipts.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

CHROME_ID = 'klfdjlbngpoopegjmbajaidgodpmjaoc'
AMO_ID = 'kicad-visual-review@wayri.github.io'
NAMES = {
    'chrome': 'kicad-visual-review-chrome-edge-brave-opera-vivaldi-chromium-{version}.zip',
    'firefox': 'kicad-visual-review-firefox-{version}.zip',
    'vscode': 'kicad-visual-review-vscode-{version}.vsix',
}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(directory, tag, commit, store, source_sha=''):
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag):
        raise ValueError('Use an exact numeric release tag.')
    version = tag[1:]
    manifest = json.loads((directory / 'release-manifest.json').read_text())
    if (manifest['version'], manifest['tag'], manifest['sourceCommit'], manifest['sourceDirty']) != (
            version, tag, commit, False):
        raise ValueError('Release provenance mismatch or dirty source.')
    sums = {}
    for line in (directory / 'SHA256SUMS.txt').read_text().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([A-Za-z0-9_.-]+)', line)
        if not match or match[2] in sums:
            raise ValueError('Malformed or duplicate checksum entry.')
        sums[match[2]] = match[1]
    if sums.get('release-manifest.json') != digest(directory / 'release-manifest.json'):
        raise ValueError('Release manifest checksum mismatch.')
    package = directory / NAMES[store].format(version=version)
    actual = digest(package)
    if actual != sums.get(package.name) or actual != manifest['assets'].get(package.name):
        raise ValueError('Store package checksum mismatch.')
    with zipfile.ZipFile(package) as archive:
        if len(archive.namelist()) != len(set(archive.namelist())):
            raise ValueError('Duplicate ZIP entries.')
        path = 'extension/package.json' if store == 'vscode' else 'manifest.json'
        info = archive.getinfo(path)
        if info.file_size > 1024 * 1024:
            raise ValueError('Oversized package metadata.')
        metadata = json.loads(archive.read(path))
    if metadata['version'] != version:
        raise ValueError('Packaged version mismatch.')
    if store == 'vscode' and (metadata['publisher'], metadata['name']) != ('wayri', 'kicad-visual-review'):
        raise ValueError('Wrong Marketplace identity.')
    if store == 'firefox' and metadata['browser_specific_settings']['gecko']['id'] != AMO_ID:
        raise ValueError('Wrong AMO identity.')
    source = directory / f'kicad-visual-review-amo-source-{version}.zip'
    if store == 'firefox':
        if not re.fullmatch('[a-f0-9]{64}', source_sha) or digest(source) != source_sha:
            raise ValueError('Matching reviewer-source archive and approved SHA-256 required.')
        notes = directory / 'RELEASE-NOTES.md'
        if digest(notes) != sums.get(notes.name) or digest(notes) != manifest['assets'].get(notes.name):
            raise ValueError('Release notes checksum mismatch.')
    return package, source


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Store redirect refused; inspect the endpoint manually.')


def request(url, token='', method='GET', body=None, content_type='application/json'):
    # Never forward credentials to a URL supplied by an API response.
    allowed = {'chromewebstore.googleapis.com', 'oauth2.googleapis.com', 'addons.mozilla.org'}
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc not in allowed:
        raise ValueError('Unexpected store endpoint.')
    headers = {'Content-Type': content_type, 'User-Agent': 'KiCad-Online-store-deploy'}
    if token:
        headers['Authorization'] = token
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=180) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Error bodies may echo private reviewer notes or credentials.
        raise RuntimeError(f'Store HTTP {error.code}; inspect its dashboard. No mutation was retried.') from None


def multipart(fields, files):
    boundary = 'kicad-' + uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, path in files.items():
        parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{path.name}"\r\nContent-Type: application/zip\r\n\r\n'.encode(), path.read_bytes(), b'\r\n'])
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), 'multipart/form-data; boundary=' + boundary


def required(name):
    value = os.environ.get(name, '')
    if not value:
        raise ValueError(f'Missing configuration: {name}')
    return value


def chrome(package, version):
    publisher = required('CHROME_PUBLISHER_ID')
    if not re.fullmatch('[A-Za-z0-9-]+', publisher):
        raise ValueError('Invalid publisher ID.')
    form = urllib.parse.urlencode({
        'client_id': required('CHROME_CLIENT_ID'),
        'client_secret': required('CHROME_CLIENT_SECRET'),
        'refresh_token': required('CHROME_REFRESH_TOKEN'),
        'grant_type': 'refresh_token',
    }).encode()
    token = 'Bearer ' + request('https://oauth2.googleapis.com/token', method='POST', body=form,
                                content_type='application/x-www-form-urlencoded')['access_token']
    item = f'v2/publishers/{publisher}/items/{CHROME_ID}'
    endpoint = 'https://chromewebstore.googleapis.com/' + item
    status = request(endpoint + ':fetchStatus', token)
    if status.get('takenDown') or status.get('warned'):
        raise ValueError('Store policy warning/takedown requires manual review.')
    submitted = status.get('submittedItemRevisionStatus')
    if submitted:
        raise ValueError('An existing Chrome submission is present. It was not cancelled or replaced.')
    published = status.get('publishedItemRevisionStatus', {})
    if any(c.get('crxVersion') == version for c in published.get('distributionChannels', [])):
        return {'state': 'already_published', 'version': version}
    upload = request('https://chromewebstore.googleapis.com/upload/' + item + ':upload', token,
                     'POST', package.read_bytes(), 'application/zip')
    state = upload.get('uploadState')
    for _ in range(30):
        if state != 'IN_PROGRESS':
            break
        time.sleep(5)
        state = request(endpoint + ':fetchStatus', token).get('lastAsyncUploadState')
    if state != 'SUCCEEDED':
        raise ValueError('Chrome upload not confirmed successful; no publish attempted.')
    result = request(endpoint + ':publish', token, 'POST', json.dumps({
        'publishType': 'DEFAULT_PUBLISH', 'skipReview': False, 'blockOnWarnings': True,
    }).encode())
    return {'state': result.get('state', 'submitted'), 'version': version}


def amo_token():
    def b64(data):
        return base64.urlsafe_b64encode(data).rstrip(b'=')
    now = int(time.time())
    claims = {'iss': required('AMO_API_KEY'), 'jti': uuid.uuid4().hex, 'iat': now, 'exp': now + 240}
    data = b64(b'{"alg":"HS256","typ":"JWT"}') + b'.' + b64(json.dumps(claims).encode())
    signature = hmac.new(required('AMO_API_SECRET').encode(), data, hashlib.sha256).digest()
    return 'JWT ' + (data + b'.' + b64(signature)).decode()


def firefox(package, source, version, notes, license_text):
    base = 'https://addons.mozilla.org/api/v5/'
    versions = base + 'addons/addon/' + urllib.parse.quote(AMO_ID, safe='') + '/versions/'
    # Use exact target lookup instead of a truncated version listing.
    try:
        existing = request(versions + version + '/', amo_token())
    except RuntimeError as error:
        if not str(error).startswith('Store HTTP 404;'):
            raise
    else:
        if not existing.get('source'):
            raise ValueError('AMO version exists without source; attach it manually, then inspect status.')
        raise ValueError('AMO version already exists; inspect its bytes, source and metadata manually. No changes made.')
    body, content_type = multipart({'channel': 'listed'}, {'upload': package})
    upload = request(base + 'addons/upload/', amo_token(), 'POST', body, content_type)
    upload_id = upload['uuid']
    if not re.fullmatch('[a-f0-9-]{36}', upload_id):
        raise ValueError('Unexpected upload ID.')
    for _ in range(60):
        if upload.get('processed'):
            break
        time.sleep(5)
        upload = request(base + f'addons/upload/{upload_id}/', amo_token())
    if not upload.get('processed') or not upload.get('valid') or upload.get('version') != version:
        raise ValueError('AMO upload validation failed or timed out; no version created.')
    # Create the version and attach source in one operation, preserving exact ZIP bytes.
    body, content_type = multipart({'upload': upload_id}, {'source': source})
    result = request(versions, amo_token(), 'POST', body, content_type)
    version_url = versions + str(int(result['id'])) + '/'
    request(version_url, amo_token(), 'PATCH', json.dumps({
        'release_notes': {'en-US': notes},
        'custom_license': {'name': {'en-US': 'KiCad Online Source-Available License 1.0'},
                           'text': {'en-US': license_text}},
        'approval_notes': f'Exact audited release {version}; matching readable source attached. Altium beta excluded.',
    }).encode())
    final = request(version_url, amo_token())
    if not final.get('source'):
        raise ValueError('AMO source attachment not confirmed; inspect dashboard.')
    return {'state': final['file']['status'], 'version': version, 'id': final['id'], 'sourceAttached': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--store', choices=NAMES, required=True)
    parser.add_argument('--source-sha256', default='')
    parser.add_argument('--submit', action='store_true')
    args = parser.parse_args()
    package, source = verify(args.directory, args.tag, args.commit, args.store, args.source_sha256)
    result = {'state': 'verified_only', 'store': args.store, 'version': args.tag[1:],
              'package': package.name, 'sha256': digest(package), 'sourceCommit': args.commit}
    if args.submit:
        if args.store == 'vscode':
            raise ValueError('Use vsce --oidc --packagePath after verification.')
        if args.store == 'chrome':
            result.update(chrome(package, args.tag[1:]))
        else:
            result.update(firefox(package, source, args.tag[1:],
                                 (args.directory / 'RELEASE-NOTES.md').read_text(),
                                 (args.directory / 'LICENSE').read_text()))
    args.directory.joinpath(f'{args.store}-submission.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
