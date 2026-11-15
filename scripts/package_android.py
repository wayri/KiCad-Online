"""Stage the shared viewer and native Android source archive; no credentials or remote code."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import zipfile
ROOT = Path(__file__).resolve().parents[1]

def source_files(root=ROOT):
    """Exclude local configuration and signing material even when ignored by Git."""
    return sorted(p for p in (root / 'android-app').rglob('*')
                  if p.is_file() and not p.is_symlink()
                  and not any(x in {'build', '.gradle', '.git'} for x in p.relative_to(root / 'android-app').parts)
                  and p.name not in {'local.properties', 'keystore.properties', 'signing.properties'}
                  and p.suffix.lower() not in {'.jks', '.keystore', '.pem', '.key', '.p12', '.pfx', '.dpapi'}
                  and not p.name.startswith('.env'))

def payload(root=ROOT):
    spec = importlib.util.spec_from_file_location('extension_builder', root / 'scripts/package_extension.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    metadata = module.version_metadata(root, 'android')
    excluded = {'managed-policy.js', 'managed-policy-schema.json', 'managed-policy-options.js', 'merge-conflicts.js', 'conflict-viewer.html', 'conflict-viewer.js', 'conflict-viewer.css', 'conflict-properties.js', 'manifest.json', 'options.html', 'options.js', 'gitlab-options.js', 'gitlab-hosts.js', 'gitlab-provider.js', 'gitlab-review-api.js', 'github-review-api.js', 'mention-users.js', 'review-file-store.js', 'review-file-settings.js', 'html-sandbox.html', 'html-sandbox.js', 'credential-vault.js', 'credential-vault-host.html', 'credential-vault-host.js', 'credential-vault-worker.js'}
    excluded.update({'dashboard.html','dashboard.css','dashboard.js','project-recents.js','native-kicad.js'})
    names = ((module.FILES | module.LEGAL_FILES) - excluded) | {'parsing.js'}
    result = {}
    for name in sorted(names):
        content = (root / 'extension' / name).read_bytes()
        if name == 'product-version.js':
            content = module.version_script(content, metadata)
        if name == 'provider-oauth.json':
            config_spec = importlib.util.spec_from_file_location('publisher_oauth', root / 'scripts/provider_oauth.py')
            config = importlib.util.module_from_spec(config_spec); config_spec.loader.exec_module(config)
            content = config.payload(root)
        if name=='browser-data.js':
            # Disk-backed imports are bounded separately; only the active drawing
            # hierarchy enters WebView memory. Desktop limits remain unchanged.
            text=content.decode('utf-8')
            text=text.replace('const PROJECT_MAX_FILES = 128, PARENT_MAX_CANDIDATES = 128', 'const PROJECT_MAX_FILES = 512, PARENT_MAX_CANDIDATES = 512')
            text=text.replace('(/\\.kicad_(pcb|sch)$/i.test(path) ? 256 : 8) * 1024 * 1024', '(/\\.kicad_(pcb|sch)$/i.test(path) ? 64 : 8) * 1024 * 1024')
            content=text.encode('utf-8')
        if name=='design-diff.js':
            content=content.replace(b'const MAX_MODERN_FILE = 256 * 1024 * 1024;', b'const MAX_MODERN_FILE = 64 * 1024 * 1024;').replace(b'modern ? 12000000',b'modern ? 6000000').replace(b'const MAX_RENDER_PRIMITIVES = 1500000;',b'const MAX_RENDER_PRIMITIVES = 250000;')
        if name=='review-workspace.js':
            text=content.decode('utf-8').replace("&&!root.KiCadVSCodeContext","&&(!root.KiCadVSCodeContext||root.KiCadAndroidOnline)")
            text=text.replace("provider!=='github'||!remoteAvailable","!remoteAvailable").replace("!remoteAvailable||provider!=='github'","!remoteAvailable").replace("provider==='github'&&remoteAvailable","remoteAvailable")
            text=text.replace('Open on GitHub','Open thread').replace('Loading GitHub thread…','Loading thread…')
            content=text.encode('utf-8')
        if name=='project-viewer.js':
            text=content.decode('utf-8')
            text=text.replace("else discover();", "else if(rootAndroidLazy()){let ready=null;addEventListener('kicad-android:settings',async event=>{const path=event.detail?.file||rootFile;if(!ready)ready=discover();await ready;if(disposed)return;if(path!==active)await load(path,'settings');else activate('settings');});}else discover();function rootAndroidLazy(){return Boolean(globalThis.KiCadAndroidRuntime);}")
            content=text.encode('utf-8')
        if name=='loading-ui.js':
            text=content.decode('utf-8').replace('root.KiCadVSCodeContext)', '(root.KiCadVSCodeContext&&!root.KiCadAndroidRuntime))')
            text=text.replace("worker.onerror=()=>finish(new Error('The loading worker could not start. Reload the extension and retry.'));", "worker.onerror=()=>{worker?.terminate();if(root.KiCadAndroidRuntime)paint().then(()=>{if(signal?.aborted)throw Error('Loading cancelled.');return fallback();}).then(value=>finish(null,value),error=>finish(error));else finish(new Error('The loading worker could not start. Reload the extension and retry.'));};")
            content=text.encode('utf-8')
        if name.endswith('.html'):
            text = content.decode('utf-8')
            text = text.replace('<link rel="stylesheet" href="ui-foundation.css">', '').replace('<link rel="stylesheet" href="compact-surfaces.css">', '')
            text = text.replace('</head>', '<link rel="stylesheet" href="android.css"><link rel="stylesheet" href="compact-ui.css"><link rel="stylesheet" href="copper-controls.css"><link rel="stylesheet" href="settings.css"><link rel="stylesheet" href="measurement-tools.css"><link rel="stylesheet" href="ui-foundation.css"><link rel="stylesheet" href="android-design.css"><link rel="stylesheet" href="compact-surfaces.css"></head>')
            text = re.sub(r'<script src=', '<script src="local-project.js"></script><script src="remote-review.js"></script><script src="revision-snapshots.js"></script><script src="runtime.js"></script><script src=', text, count=1)
            text = text.replace('</body>', '<script src="android-project.js"></script><script src="touch-tooltips.js"></script><script src="resizable-sheets.js"></script><script src="adaptive-ui.js"></script><script src="measurement-tools.js"></script><script src="presentation.js"></script><script src="engineering-tools.js"></script><script src="android-design.js"></script><script src="edge-to-edge.js"></script></body>')
            # Folder HTML is deliberately excluded: it must never execute with a native bridge.
            content = text.encode('utf-8')
        result[name] = content
    for source in (root / 'android-app/web').iterdir():
        if source.is_file():
            content=(root/'extension/local-project.js').read_bytes() if source.name=='local-project.js' else source.read_bytes()
            if source.name=='about.html':
                content=content.replace(b'__APP_VERSION__',metadata['appVersion'].encode('utf-8')).replace(b'__RELEASE_VERSION__',metadata['release'].encode('utf-8'))
            result[source.name]=content
    result['app-logo.png']=(root/'android-app/app/src/main/res/drawable/app_icon.png').read_bytes()
    result['VERSION.txt'] = module.version_text(metadata)
    result['shared-assets.json'] = (json.dumps({'assets': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(result.items())}}, indent=2)+'\n').encode()
    return result

def package(root=ROOT):
    assets = root / 'android-app/app/src/main/assets/viewer'
    for name, data in payload(root).items():
        path = assets / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
    output = root / 'dist/pocket-kivi-android-source.zip'; output.parent.mkdir(parents=True, exist_ok=True)
    sources = source_files(root)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        info = zipfile.ZipInfo('VERSION.txt', (2020,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.external_attr=0o100644 << 16
        archive.writestr(info, (assets / 'VERSION.txt').read_bytes())
        for path in sources:
            info = zipfile.ZipInfo(str(path.relative_to(root)).replace('\\','/'), (2020,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.external_attr=0o100644 << 16; archive.writestr(info,path.read_bytes())
    return output
if __name__ == '__main__': print(package())
