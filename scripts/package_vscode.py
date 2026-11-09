"""Prepare explicit shared media and build a deterministic local VSIX."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import zipfile
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ('analysis-data.js', 'analysis-viewer.html', 'analysis-viewer.css', 'analysis-viewer.js', 'merge-conflicts.js', 'conflict-viewer.html', 'conflict-viewer.js', 'conflict-viewer.css', 'conflict-properties.js', 'bom-manager.js', 'bom-manager.css', 'step-worker-vscode.js', 'vendor/occt/occt-import-js.wasm', 'vendor/occt/NOTICE.md',
    'vendor/occt/license.occt-import-js.txt', 'vendor/occt/license.occt.txt', 'vendor/occt/OCCT_LGPL_EXCEPTION.txt', 'vendor/occt/EMSCRIPTEN-LICENSE.txt',
    'loading-ui.js', 'load-worker.js', 'bom-analytics.js', 'file-compatibility.js', 'html-preview.js', 'html-sandbox.html', 'html-sandbox.js',
    'parsing.js', 'project-viewer.html', 'project-viewer.css', 'project-viewer.js', 'project-settings.js', 'project-settings-ui.js', 'gerber-renderer.js',
    'revision-viewer.html', 'revision-viewer.css', 'revision-viewer.js', 'terms.html',
    'ui-icons.js', 'browser-data.js', 'legacy-kicad.js', 'design-diff.js', 'design-model.js',
    'net-model.js', 'overview-connectivity.js', 'ratsnest.js', 'paired-review.js', 'project-search.js', 'workspace-search.js', 'rule-reports.js', 'review-navigation.js', 'view-state.js', 'review-comments.js', 'comment-compose.js', 'review-workspace.js', 'review-tools.js', 'repo-models.js',
    'worksheet.js', 'schematic-renderer.js', 'pcb-renderer.js', 'pad-labels.js', 'owned-canvas.js', 'touch-canvas.js', 'motion-webgl.js',
    'vendor/spike-board3d.bundle.js', 'vendor/SPIKE-ENGINE-NOTICE.md', 'vendor/THREE-LICENSE',
)
ASSETS += ('population-inspection.js','population-photo.js','population-review.js','testpoint-tools.js','photo-alignment.js','component-links.js','photo-review.js','photo-review.css')
ASSETS += ('compact-surfaces.css','compact-surfaces.js')
ASSETS += ('workspace-chrome.css','workspace-chrome.js','chat-content.js','chat-panel.js','chat-panel.css','review-sync.js','work-board-panel.js')
ASSETS += ('ui-foundation.css','tool-surfaces.css','gerber-camera.js')
ASSETS += ('pdf-tools.js','pdf-viewer.html','pdf-viewer.css','pdf-viewer.js','vendor/pdfjs/FILES.json') + tuple('vendor/pdfjs/'+name for name in json.loads((ROOT/'extension/vendor/pdfjs/FILES.json').read_text())['files'])
ASSETS += ('mention-users.js','repository-explorer.js','repository-explorer.css','layer-colors.js','load-worker-vscode.js')
ASSETS += ('engineering-launcher.js', 'review-handoff.js', 'local-runtime.js')
ASSETS += ('net-quick-view.js',)
ASSETS += ('window-link.js','detached-view.js')
ASSETS += ('fast-pi.js','fast-pi-worker.js','fast-pi-worker-vscode.js','fast-pi-field.js','fast-pi-workspace.js','fast-pi-workspace.css')
ASSETS += ('product-version.js', 'product-info.js')
BUILD_INPUTS = ('github-review-api.js', 'gitlab-review-api.js', 'step-decoder.js', 'step-worker.js', 'vendor/occt/occt-import-js.js')
ASSETS += ('history-timeline.js', 'history-timeline.css', 'local-runtime.js', 'local-project.js', 'unified-comparison.js', 'comparison-viewer.html', 'comparison-viewer.js', 'comparison-viewer.css', 'comparison-worker.js', 'variant-manager.js', 'bom-import.js', 'bom-browser.js', 'bom-browser.css', 'bom-viewer.html', 'bom-viewer.js','bom-workspace.js', 'bom-field-table.js', 'bom-viewer.css', 'calculator-tools.js', 'calculator-viewer.html', 'calculator-viewer.js', 'calculator-viewer.css', 'analysis-spatial.js', 'analysis-overlay.js', 'analysis-bom-link.js')
ASSETS += ('calculator-catalog.js','calculator-visuals.js')
ASSETS += ('tool-header.css','tool-header.js')
ASSETS += ('draftsman-model.js','draftsman-mechanical.js','draftsman-snap.js','draftsman-export.js','draftsman-workspace.js','draftsman-workspace.css')
ASSETS += ('overview-routing.js','comment-focus.js')
ASSETS += ('startup-health.js','revision-actions.js','revision-fork.js','analysis-simulation.js','analysis-simulation.css')
ASSETS += ('section-pages.js','section-pages.css','board-setup-ui.js','board-setup-ui.css','mobile-sidebar.js','mobile-sidebar.css','testpoint-tools.css','sheet-hierarchy-links.js','responsive-controls.js','phone-polish.css')
HOST_FILES = ('git-history-tree.js', 'remote-collaboration.js', 'conflict-host.js', 'package.json', 'extension.js', 'webview-bridge.js', 'README.md', 'GUIDE.md', 'icon.png', 'LICENSE.txt')
README_IMAGES = ('images/schematic-review.jpg', 'images/pcb-inspection.jpg',
                 'images/assembly-bom.jpg', 'images/visual-merge-conflict.jpg',
                 'images/open-viewer-command.jpg', 'images/copper-net-names.jpg')
HOST_FILES += README_IMAGES + ('revision-export.js',)


def adapt_entry(source: bytes) -> bytes:
    original = b'new URLSearchParams(location.search)'
    if source.count(original) != 1:
        raise ValueError('Shared revision entry changed; review the VS Code context adapter.')
    return source.replace(original, b'new URLSearchParams(globalThis.KiCadVSCodeContext?.search ?? location.search)')


def host_review_factory(source: bytes, provider: str) -> bytes:
    text = source.decode('utf-8')
    symbol = 'KiCadGitHubReviewApi' if provider == 'github' else 'KiCadGitLabReviewApi'
    start = '  async function readCredential() {' if provider == 'github' else '  async function credential(host) {'
    end = '  async function tokenStatus() {' if provider == 'github' else '  function validToken(token) {'
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError('Review credential adapter changed; review host integration.')
    a, b = text.index(start), text.index(end)
    replacement = ('  async function readCredential() { return dependencies.credential(); }\n' if provider == 'github'
                   else '  async function credential(host) { return dependencies.credential(validateHost(host)); }\n')
    text = text[:a] + replacement + text[b:]
    text = text[:text.index('if (typeof globalThis === "object") globalThis.' + symbol)]
    return ('"use strict";\n// Generated from shared review API; secrets are supplied only by the VS Code host.\n'
            'module.exports=function(dependencies){\nconst {chrome,fetch,crypto,KiCadReviewComments}=dependencies;\n'
            + text + '\nreturn ' + symbol + ';\n};\n').encode('utf-8')


def prepare_media(root: Path = ROOT) -> dict[str, bytes]:
    for name in (*ASSETS, *BUILD_INPUTS):
        if not (root / 'extension' / name).is_file():
            raise ValueError(f'Missing shared viewer asset: {name}')
    spec = importlib.util.spec_from_file_location('build_step_worker', Path(__file__).with_name('build_step_worker.py'))
    worker_builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker_builder)
    expected_worker = worker_builder.bundle(root)
    if (root / 'extension/step-worker-vscode.js').read_bytes() != expected_worker:
        raise ValueError('STEP worker bundle is stale; run scripts/build_step_worker.py.')
    load_spec = importlib.util.spec_from_file_location('build_load_worker', Path(__file__).with_name('build_load_worker.py'))
    load_builder = importlib.util.module_from_spec(load_spec)
    load_spec.loader.exec_module(load_builder)
    if (root / 'extension/load-worker-vscode.js').read_bytes() != load_builder.bundle(root):
        raise ValueError('Preparation worker bundle is stale; run scripts/build_load_worker.py.')
    fast_spec = importlib.util.spec_from_file_location('build_fast_pi_worker', Path(__file__).with_name('build_fast_pi_worker.py'))
    fast_builder = importlib.util.module_from_spec(fast_spec)
    fast_spec.loader.exec_module(fast_builder)
    if (root / 'extension/fast-pi-worker-vscode.js').read_bytes() != fast_builder.bundle(root):
        raise ValueError('Fast PI worker bundle is stale; run scripts/build_fast_pi_worker.py.')
    version_spec = importlib.util.spec_from_file_location('version_builder', Path(__file__).with_name('package_extension.py'))
    version_builder = importlib.util.module_from_spec(version_spec); version_spec.loader.exec_module(version_builder)
    metadata = version_builder.version_metadata(root, 'vscode')
    payload, hashes = {}, {}
    destination = root / 'vscode-extension' / 'media'
    for name in ASSETS:
        path = root / 'extension' / name
        if not path.is_file():
            raise ValueError(f'Missing shared viewer asset: {name}')
        source = path.read_bytes()
        content = adapt_entry(source) if name == 'revision-viewer.js' else source
        if name == 'product-version.js':
            content = version_builder.version_script(source, metadata)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        payload[f'extension/media/{name}'] = content
        hashes[name] = {'sourceSha256': hashlib.sha256(source).hexdigest(),
                        'packagedSha256': hashlib.sha256(content).hexdigest()}
    for provider in ('github', 'gitlab'):
        source = (root / 'extension' / f'{provider}-review-api.js').read_bytes()
        content = host_review_factory(source, provider)
        name = f'{provider}-review-host-api.js'
        (destination / name).write_bytes(content)
        payload[f'extension/media/{name}'] = content
        hashes[name] = {'sourceSha256': hashlib.sha256(source).hexdigest(), 'packagedSha256': hashlib.sha256(content).hexdigest()}
    version_content = version_builder.version_text(metadata)
    (destination / 'VERSION.txt').write_bytes(version_content)
    payload['VERSION.txt'] = version_content
    payload['extension/media/VERSION.txt'] = version_content
    hashes['VERSION.txt'] = {'packagedSha256': hashlib.sha256(version_content).hexdigest()}
    inventory = (json.dumps({'format': 1, 'assets': hashes}, indent=2, sort_keys=True) + '\n').encode()
    (destination / 'shared-assets.json').write_bytes(inventory)
    payload['extension/media/shared-assets.json'] = inventory
    return payload


def vsix_manifest(manifest: dict) -> bytes:
    name, publisher, version = (escape(str(manifest[key]), {'"': '&quot;'}) for key in ('name', 'publisher', 'version'))
    title, description = escape(manifest['displayName']), escape(manifest['description'])
    engine = escape(manifest['engines']['vscode'], {'"': '&quot;'})
    return f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{publisher}" />
    <DisplayName>{title}</DisplayName><Description xml:space="preserve">{description}</Description>
    <GalleryFlags>Public</GalleryFlags>
    <Categories>Visualization</Categories><Tags>KiCad,schematic,PCB,github.dev</Tags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{engine}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
    </Properties>
    <License>extension/LICENSE.txt</License><Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
'''.encode()


CONTENT_TYPES = b'''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="jpg" ContentType="image/jpeg" />
  <Default Extension="xml" ContentType="application/xml" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Override PartName="/extension/media/vendor/THREE-LICENSE" ContentType="text/plain" />
</Types>
'''


def package(root: Path = ROOT, output: Path | None = None) -> Path:
    folder = root / 'vscode-extension'
    manifest = json.loads((folder / 'package.json').read_text(encoding='utf-8'))
    if manifest['main'] != './extension.js' or manifest['browser'] != './extension.js':
        raise ValueError('Desktop and browser entrypoints must use the audited shared host.')
    payload = prepare_media(root)
    for name in HOST_FILES:
        path = folder / name
        if not path.is_file():
            raise ValueError(f'Missing VS Code host file: {name}')
        payload[f'extension/{name}'] = path.read_bytes()
    for image in re.findall(r'!\[[^\]]*\]\(([^)]+)\)', (folder / 'README.md').read_text(encoding='utf-8')):
        if image.startswith(('https://', 'http://')):
            continue
        if f'extension/{image}' not in payload:
            raise ValueError(f'Unpackaged README image: {image}')
    payload['extension.vsixmanifest'] = vsix_manifest(manifest)
    payload['[Content_Types].xml'] = CONTENT_TYPES
    output = output or root / 'build' / f"kicad-visual-review-vscode-{manifest['version']}.vsix"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(payload.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return output


if __name__ == '__main__':
    print(package())
