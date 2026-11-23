"""Generate a deterministic unsigned Firefox MV3 archive from the shared inventory.

Firefox uses an event-page background rather than Chromium's service worker.
Repository HTML is deliberately static: no unsupported manifest sandbox is used.
"""
from pathlib import Path
import importlib.util
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SHIM = 'firefox/browser-api.js'
ADDON_ID = 'kicad-visual-review@wayri.github.io'
# Provider repository requests, optional account authentication, and explicit
# review publication transmit these categories outside the local browser.
# Required install consent covers the existing provider features; no optional
# data permission is declared without a corresponding runtime consent gate.
DATA_COLLECTION_TYPES = (
    'authenticationInfo', 'browsingActivity', 'personalCommunications',
    'personallyIdentifyingInfo', 'websiteActivity', 'websiteContent',
)


def chrome_builder():
    spec = importlib.util.spec_from_file_location('package_extension', ROOT / 'scripts/package_extension.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def adapt_background(source: bytes) -> tuple[bytes, list[str]]:
    text = source.decode('utf-8')
    matches = list(re.finditer(r'^importScripts\(([^\n]+)\);\r?$', text, re.MULTILINE))
    if len(matches) != 1:
        raise ValueError('Background imports changed; review the Firefox event-page adapter.')
    match = matches[0]
    try:
        dependencies = json.loads('[' + match.group(1) + ']')
    except json.JSONDecodeError as error:
        raise ValueError('Background import list must contain literal file names.') from error
    if not all(isinstance(name, str) and re.fullmatch(r'[a-z0-9-]+\.js', name) for name in dependencies):
        raise ValueError('Unsafe background dependency.')
    return (text[:match.start()] + text[match.end():]).encode(), dependencies


def adapt_project_entry(source: bytes, browser_name: str = 'Firefox') -> bytes:
    original = b"frame.setAttribute('sandbox','allow-scripts');frame.src=chrome.runtime.getURL('html-sandbox.html');const content=source;frame.onload=()=>frame.contentWindow.postMessage({type:'kicad-html-preview',content},'*');"
    if source.count(original) != 1:
        raise ValueError('HTML preview entry changed; review the static isolated preview adapter.')
    replacement = ("frame.setAttribute('sandbox','');frame.srcdoc=KiCadHTMLPreview.documentFor(source,{interactive:false});"
                   "status('Static HTML preview in " + browser_name + "; repository scripts and interactive iBOM are disabled.');").encode()
    return source.replace(original, replacement)


def adapt_html(source: bytes, *, project: bool = False, shim: str = SHIM) -> bytes:
    marker = b'<script '
    if marker not in source:
        raise ValueError('Privileged extension HTML lacks script entry point.')
    injection = f'<script src="{shim}"></script>'.encode()
    if project:
        injection += b'<script src="html-preview.js"></script>'
    return source.replace(marker, injection + marker, 1)


def payload(root: Path = ROOT) -> dict[str, bytes]:
    source = root / 'extension'
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    worker = manifest['background']['service_worker']
    background, dependencies = adapt_background((source / worker).read_bytes())
    builder = chrome_builder()
    metadata = builder.version_metadata(root, 'firefox')
    files = set(builder.FILES) | builder.LEGAL_FILES | {worker, SHIM}
    files.update(manifest.get('icons', {}).values())
    for content in manifest['content_scripts']:
        files.update(content['js'])
        content['js'].insert(0, SHIM)
    files.update(dependencies)
    files.discard('html-sandbox.html')
    files.discard('html-sandbox.js')
    # Firefox supplies its own maintained PDF renderer; do not fork PDF.js.
    font_assets = {'vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf', 'vendor/pdfjs/standard_fonts/LICENSE_LIBERATION'}
    files = {name for name in files if not name.startswith('vendor/pdfjs/')} | font_assets
    manifest['background'] = {'scripts': [SHIM, *dependencies, worker]}
    manifest['browser_specific_settings'] = {'gecko_android': {'strict_min_version': '142.0'}, 'gecko': {
        'id': ADDON_ID,
        'strict_min_version': '140.0',
        'data_collection_permissions': {'required': list(DATA_COLLECTION_TYPES)},
    }}
    manifest.pop('sandbox', None)
    manifest['permissions'] = [permission for permission in manifest['permissions'] if permission != 'offscreen']
    manifest['content_security_policy'].pop('sandbox', None)
    data = {}
    for name in sorted(files):
        path = source / ('firefox/' + name if name in {'credential-vault.js', 'pdf-viewer.html', 'pdf-viewer.js'} else name)
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(source.resolve()):
            raise ValueError(f'Unsafe or missing Firefox asset: {name}')
        content = path.read_bytes()
        if name == 'product-version.js':
            content = builder.version_script(content, metadata)
        elif name == 'manifest.json':
            content = (json.dumps(manifest, indent=2) + '\n').encode()
        elif name == worker:
            content = background
        elif name.endswith('.html') and name not in builder.LEGAL_FILES:
            content = adapt_html(content, project=name == 'project-viewer.html')
            if name == 'project-viewer.html':
                content = content.replace(b'Isolated self-contained HTML preview.', b'Static isolated HTML preview in Firefox. Repository scripts and interactive iBOM are disabled.')
        elif name == 'project-viewer.js':
            content = adapt_project_entry(content)
        elif name == 'gitlab-hosts.js':
            if b'.registerContentScripts(' in content:
                raise ValueError('Persistent GitLab page injection is not permitted; use the on-click repository bridge.')
        elif name == 'review-file-settings.js':
            content = content.replace(b'Connect .kicad-review.json inside your local Git checkout.', b'Firefox cannot write a selected local review file automatically. Export review JSON from the viewer and save .kicad-review.json in your Git checkout.')
            content = content.replace(b'File access requires a supported Chrome extension page.', b'Firefox does not support this file picker. Export review JSON from the viewer and save it in your checkout.')
        data[name] = content
    data['VERSION.txt'] = builder.version_text(metadata)
    return data


def package(root: Path = ROOT, output: Path | None = None) -> Path:
    data = payload(root)
    version = json.loads(data['manifest.json'])['version']
    output = output or root / '.vizdiff' / f'kicad-visual-review-firefox-{version}.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(data.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return output


if __name__ == '__main__':
    print(package())
