"""Build a deterministic browser-store archive from an explicit source inventory."""
from pathlib import Path
import json
import importlib.util
import zipfile
import re

ROOT = Path(__file__).resolve().parents[1]
LEGAL_FILES = {'terms.html', 'LICENSE.txt'}
MODEL_FILES = {'embedded-models.js', 'vendor/fzstd/fzstd.js', 'vendor/fzstd/LICENSE'}
FILES = {'analysis-data.js', 'analysis-viewer.html', 'analysis-viewer.css', 'analysis-viewer.js', 'touch-canvas.js', 'merge-conflicts.js', 'conflict-viewer.html', 'conflict-viewer.js', 'conflict-viewer.css', 'conflict-properties.js', 'bom-manager.js', 'bom-manager.css', 'part-fields.js', 'BRAND-ASSETS.md', 'step-decoder.js', 'step-worker.js', 'vendor/occt/occt-import-js.js', 'vendor/occt/occt-import-js.wasm', 'vendor/occt/license.occt-import-js.txt', 'vendor/occt/license.occt.txt', 'vendor/occt/NOTICE.md', 'vendor/occt/OCCT_LGPL_EXCEPTION.txt', 'vendor/occt/EMSCRIPTEN-LICENSE.txt', 'gitlab-review-api.js', 'gitlab-hosts.js', 'gitlab-options.js', 'gitlab-provider.js', 'loading-ui.js', 'load-worker.js', 'bom-analytics.js', 'file-compatibility.js', 'html-preview.js', 'html-sandbox.html', 'html-sandbox.js', 'revision-picker.js', 'project-viewer.html', 'project-viewer.css', 'project-viewer.js', 'project-settings.js', 'project-settings-ui.js', 'gerber-renderer.js', 'manifest.json',  'browser-data.js', 'legacy-kicad.js', 'design-diff.js',
         'design-model.js', 'net-model.js', 'overview-connectivity.js', 'ratsnest.js', 'paired-review.js', 'project-search.js', 'rule-reports.js', 'review-navigation.js', 'ui-icons.js', 'worksheet.js', 'view-state.js', 'review-comments.js', 'comment-compose.js', 'review-workspace.js', 'github-review-api.js', 'mention-users.js', 'options.html', 'options.js', 'review-file-store.js', 'review-file-settings.js',
         'review-tools.js', 'repo-models.js', 'browser-viewer.html', 'browser-viewer.js', 'revision-viewer.html', 'schematic-viewer.html',
         'pcb-viewer.html', 'revision-viewer.css', 'revision-viewer.js', 'pad-labels.js', 'owned-canvas.js', 'motion-webgl.js',
         'schematic-renderer.js', 'pcb-renderer.js', 'vendor/spike-board3d.bundle.js',
         'vendor/SPIKE-ENGINE-NOTICE.md', 'vendor/THREE-LICENSE', 'credential-vault.js',
         'credential-vault-host.html', 'credential-vault-host.js', 'credential-vault-worker.js'}
FILES.update({'history-timeline.js', 'history-timeline.css', 'unified-comparison.js', 'comparison-viewer.html', 'comparison-viewer.css', 'comparison-viewer.js', 'comparison-worker.js'})
FILES.update({'repository-sessions.js','inline-project-view.js','net-quick-view.js','github-website-history.js','github-website-pulls.js','github-session-reader.js','gitlab-session-reader.js','parsing.js','repository-session-bridge.js'})
FILES.update({'github-session-review.js','github-website-reviews.js','session-reviews.html','session-reviews.js','session-reviews.css'})
FILES.update({'window-link.js','detached-view.js','github-project-buffer.js','github-project-view.js','workspace-search.js'})
FILES.update({'fast-pi.js','fast-pi-worker.js','fast-pi-field.js','fast-pi-workspace.js','fast-pi-workspace.css'})
FILES.update({'draftsman-model.js','draftsman-mechanical.js','draftsman-snap.js','draftsman-export.js','draftsman-workspace.js','draftsman-workspace.css','draftsman-repository.js'})
FILES.update({'overview-routing.js','dashboard.html','dashboard.css','dashboard.js','project-recents.js'})
FILES.update({'workspace-chrome.css','workspace-chrome.js','revision-actions.js','revision-fork.js','analysis-simulation.js','analysis-simulation.css'})
FILES.update({'provider-oauth.js','provider-oauth.json'})
FILES.update({'project-launch.js','project-launcher.html','project-launcher.js','project-launcher.css'})
FILES.update({'native-kicad.js', 'comment-focus.js'})
FILES.update({'chat-content.js','chat-panel.js','chat-panel.css','review-sync.js','work-board-panel.js'})
FILES.update({'compact-surfaces.css','compact-surfaces.js'})
FILES.update({'managed-policy.js','managed-policy-schema.json','managed-policy-options.js'})
FILES.update(MODEL_FILES)
FILES.update({'repository-explorer.js','repository-explorer.css','layer-colors.js'})
FILES.update({'engineering-launcher.js', 'review-handoff.js', 'local-project.js', 'local-import.js', 'local-runtime.js', 'local-viewer.html', 'local-viewer.js', 'local-viewer.css', 'local-layout.js'})
FILES.update({'analysis-spatial.js', 'analysis-overlay.js'})
FILES.update({'variant-manager.js', 'bom-import.js', 'bom-browser.js', 'bom-browser.css', 'bom-viewer.html', 'bom-viewer.js','bom-workspace.js', 'bom-field-table.js', 'bom-viewer.css', 'calculator-tools.js', 'calculator-viewer.html', 'calculator-viewer.js', 'calculator-viewer.css', 'analysis-bom-link.js', 'gerber-analysis.js', 'gerber-viewer.html', 'gerber-viewer.js', 'gerber-viewer.css'})
FILES.update({'calculator-catalog.js','calculator-visuals.js'})
FILES.update({'tool-header.css','tool-header.js'})
FILES.update({'startup-health.js','environment-diagnostics.js','environment-options.js'})

FILES.update({'population-inspection.js','population-photo.js','population-review.js','testpoint-tools.js','photo-alignment.js','component-links.js','photo-review.js','photo-review.css'})
FILES.update({'ui-foundation.css','tool-surfaces.css','gerber-camera.js'})
PDF_FILES = {'pdf-tools.js','pdf-viewer.html','pdf-viewer.css','pdf-viewer.js','vendor/pdfjs/FILES.json'} | {'vendor/pdfjs/'+name for name in json.loads((ROOT/'extension/vendor/pdfjs/FILES.json').read_text())['files']}
FILES.update(PDF_FILES)
FILES.update({'section-pages.js','section-pages.css','board-setup-ui.js','board-setup-ui.css','mobile-sidebar.js','mobile-sidebar.css','testpoint-tools.css','sheet-hierarchy-links.js','responsive-controls.js','phone-polish.css'})

FILES.update({'product-version.js', 'product-info.js'})
PLATFORMS = {'chrome': 'Chrome / Chromium', 'firefox': 'Firefox', 'local': 'Local viewer',
             'web': 'Web viewer', 'vscode': 'VS Code', 'android': 'Android', 'safari': 'Safari development'}

def version_metadata(root: Path, platform: str) -> dict[str, str]:
    """Read canonical product versions; never infer versions from output filenames."""
    if platform not in PLATFORMS:
        raise ValueError('Unknown product version platform')
    manifest = root / ('vscode-extension/package.json' if platform == 'vscode' else 'extension/manifest.json')
    release = json.loads(manifest.read_text(encoding='utf-8'))['version']
    app_version = release
    if platform == 'android':
        source = (root / 'android-app/app/build.gradle').read_text(encoding='utf-8')
        matches = re.findall(r"^\s*versionName\s+['\"]([^'\"]+)['\"]\s*$", source, re.MULTILINE)
        if len(matches) != 1:
            raise ValueError('Android requires one literal versionName')
        app_version = matches[0]
    for value in (release, app_version):
        if not isinstance(value, str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,3}', value):
            raise ValueError('Invalid canonical product version')
    return {'release': release, 'appVersion': app_version, 'platform': PLATFORMS[platform]}


def version_text(metadata: dict[str, str]) -> bytes:
    return ('KiCad Online\nRelease: '+metadata['release']+'\nAppVersion: '+metadata['appVersion']+
            '\nPlatform: '+metadata['platform']+'\n').encode('utf-8')


def version_script(source: bytes, metadata: dict[str, str]) -> bytes:
    """Replace complete quoted literals, preserving JavaScript escaping deterministically."""
    text = source.decode('utf-8')
    for token, key in [('__RELEASE_VERSION__', 'release'), ('__APP_VERSION__', 'appVersion'), ('__PLATFORM__', 'platform')]:
        pattern = r"(['\"])" + token + r"\1"
        if len(re.findall(pattern, text)) != 1:
            raise ValueError('Product version template requires one quoted '+token)
        text = re.sub(pattern, lambda _match: json.dumps(metadata[key], ensure_ascii=True), text)
    if re.search(r'__(?:RELEASE_VERSION|APP_VERSION|PLATFORM)__', text):
        raise ValueError('Unresolved product version template')
    return text.encode('utf-8')


def package(root: Path = ROOT, output: Path | None = None) -> Path:
    source = root / 'extension'
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    metadata = version_metadata(root, 'chrome')
    files = set(FILES) | LEGAL_FILES | MODEL_FILES
    files.add(manifest['background']['service_worker'])
    for script in manifest['content_scripts']:
        files.update(script['js'])
    files.update(manifest.get('icons', {}).values())
    for name in files:
        path = source / name
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(source.resolve()):
            raise ValueError(f'Manifest references an unsafe or missing file: {name}')
    output = output or root / '.vizdiff' / f"kicad-visual-review-chrome-edge-brave-opera-vivaldi-chromium-{manifest['version']}.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(files | {'VERSION.txt'}):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            content = version_text(metadata) if name == 'VERSION.txt' else (source / name).read_bytes()
            if name == 'product-version.js':
                content = version_script(content, metadata)
            if name == 'provider-oauth.json':
                spec = importlib.util.spec_from_file_location('publisher_oauth', root / 'scripts/provider_oauth.py')
                config = importlib.util.module_from_spec(spec); spec.loader.exec_module(config)
                content = config.payload(root)
            archive.writestr(info, content)
    return output

if __name__ == '__main__':
    print(package())
