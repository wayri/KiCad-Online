import importlib.util
from pathlib import Path
import unittest
import tempfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('android_package',ROOT/'scripts/package_android.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class AndroidPackageTests(unittest.TestCase):
    def test_mobile_source_profile_does_not_inherit_desktop_256_mib_ceiling(self):
        assets=builder.payload()
        self.assertIn(b'const MAX_MODERN_FILE = 64 * 1024 * 1024;',assets['design-diff.js'])
        self.assertIn(b'modern ? 6000000',assets['design-diff.js'])
        self.assertIn(b'const MAX_RENDER_PRIMITIVES = 250000;',assets['design-diff.js'])
        self.assertIn(b'(pcb|sch)$/i.test(path) ? 64 : 8',assets['browser-data.js'])
    def test_source_archive_excludes_local_signing_material(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            app=root/'android-app';app.mkdir()
            for name in ('build.gradle','local.properties','signing.properties','keystore.properties','upload.jks','upload.keystore','private.pem','private.key','upload.p12','upload.pfx','password.dpapi','.env.upload'):
                (app/name).write_text('fixture',encoding='utf-8')
            (app/'build').mkdir();(app/'build'/'cached.txt').write_text('fixture')
            self.assertEqual([p.name for p in builder.source_files(root)],['build.gradle'])
    def test_shared_engine_and_native_runtime_are_packaged_without_online_credentials(self):
        assets=builder.payload()
        for name in ('owned-canvas.js','schematic-renderer.js','pcb-renderer.js'):
            self.assertEqual(assets[name],(ROOT/'extension'/name).read_bytes())
        self.assertIn(b'root.KiCadAndroidOnline', assets['review-workspace.js'])
        self.assertIn(b"if(!remoteAvailable)return",assets['review-workspace.js'])
        for name in ('remote-review.js','gitlab.js','github.js','index.html','index.js','runtime.js','local-project.js','touch-canvas.js','vendor/spike-board3d.bundle.js','vendor/occt/occt-import-js.wasm'):
            self.assertIn(name,assets)
        for name in ('options.html','credential-vault.js','html-sandbox.html'):
            self.assertNotIn(name,assets)
        page=assets['revision-viewer.html'].decode()
        self.assertLess(page.index('runtime.js'),page.index('revision-viewer.js'))
        root_page=assets['index.html'].decode()
        self.assertLess(root_page.index('revision-snapshots.js'),root_page.index('index.js'))
        self.assertIn(b'window.top.KiCadAndroid.ensureSnapshots()',assets['runtime.js'])
        self.assertNotIn(b'KiCadAndroidSnapshots.create(',assets['runtime.js'])
        self.assertLess(page.index('owned-canvas.js'),page.index('touch-canvas.js'))
        self.assertLess(page.index('touch-canvas.js'),page.index('revision-viewer.js'))
        self.assertLess(page.index('adaptive-ui.js'),page.index('measurement-tools.js'))
        self.assertIn('measurement-tools.css',page)
        self.assertIn(b'id="probeA"',assets['analysis-viewer.html'])
    def test_fast_pi_worker_and_compact_views_are_available_offline(self):
        assets=builder.payload()
        for name in ('fast-pi.js','fast-pi-worker.js','fast-pi-workspace.js','fast-pi-workspace.css'):
            self.assertEqual(assets[name],(ROOT/'extension'/name).read_bytes())
        for page in ('pcb-viewer.html','schematic-viewer.html','revision-viewer.html'):
            text=assets[page].decode()
            self.assertIn('fast-pi-workspace.js',text)
            self.assertLess(text.index('fast-pi-workspace.js'),text.index('review-workspace.js'))
            self.assertIn('android-design.js',text)
        self.assertIn(b'openFastPI',assets['android-design.js'])
        self.assertIn(b'kicad-review:simulation-view',assets['android-design.js'])

    def test_html_local_script_references_resolve_in_bundle(self):
        import re
        assets=builder.payload()
        for name,data in assets.items():
            if name.endswith('.html'):
                for script in re.findall(r'<script src="([^"]+)"',data.decode()):
                    self.assertIn(script,assets,name+': missing '+script)
if __name__=='__main__': unittest.main()
