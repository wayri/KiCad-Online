"""Tiny archive fixtures exercise real packaging paths without building releases."""
import importlib.abc
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = (ROOT/'extension/product-version.js').read_bytes()

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/f'{name}.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

class ProductVersionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.common = load('package_extension')
        self.put('extension/vendor/pdfjs/FILES.json', '{"files":[]}')
        for name in ('LiberationSans-Regular.ttf', 'LICENSE_LIBERATION'):
            self.put(f'extension/vendor/pdfjs/standard_fonts/{name}', b'Firefox PDF font fixture')
        self.manifest = {'version':'0.12.78','background':{'service_worker':'background.js'},'content_scripts':[],
                         'icons':{},'permissions':['offscreen'],'content_security_policy':{'extension_pages':"script-src 'self'",'sandbox':"sandbox allow-scripts"}}
        self.put('extension/manifest.json', json.dumps(self.manifest))
        self.put('extension/product-version.js', TEMPLATE)
        self.put('extension/product-info.js', '// About UI fixture\n')
        self.put('extension/parsing.js', '// parser fixture\n')
        self.put('extension/local-viewer.html','<html><script src="product-version.js"></script></html>')
        self.put('extension/background.js', 'importScripts("dep.js");\n')
        self.put('extension/dep.js', '// dependency\n')
        self.put('extension/github-review-api.js', '// host input\n')
        self.put('extension/gitlab-review-api.js', '// host input\n')
        self.put('extension/firefox/browser-api.js', '// browser shim\n')
        script = (ROOT/'scripts/package_extension.py').read_text(encoding='utf-8')
        script += "\nFILES={'manifest.json','product-version.js','product-info.js','local-viewer.html'}\nLEGAL_FILES=set()\nMODEL_FILES=set()\n"
        self.put('scripts/package_extension.py', script)
        self.put('docs/LOCAL-VIEWER.md', 'Local fixture\n')
        self.put('android-app/app/build.gradle', "android {\n defaultConfig {\n versionName '1.78'\n }\n}\n")
        self.put('android-app/web/about.html', 'App __APP_VERSION__; release __RELEASE_VERSION__\n')
        self.put('android-app/app/src/main/res/drawable/app_icon.png', b'png-fixture')

    def put(self, name, content):
        target = self.root/name; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content if isinstance(content, bytes) else content.encode('utf-8'))
        return target

    def check(self, data, prefix='', app='0.12.78', platform=None, version_path=None):
        text = data[version_path or prefix+'VERSION.txt'].decode('utf-8')
        self.assertIn('Release: 0.12.78\n',text); self.assertIn(f'AppVersion: {app}\n',text)
        self.assertIn('Platform: '+platform+'\n',text)
        script = data[prefix+'product-version.js']
        for token in (b'__RELEASE_VERSION__', b'__APP_VERSION__', b'__PLATFORM__'):
            self.assertNotIn(token,script)
        self.assertIn(json.dumps(app).encode(),script); self.assertIn(json.dumps(platform).encode(),script)
        self.assertEqual((self.root/'extension/product-version.js').read_bytes(),TEMPLATE)

    def test_metadata_canonical_versions_and_json_safe_literal_replacement(self):
        meta=self.common.version_metadata(self.root,'android')
        self.assertEqual(meta,{'release':'0.12.78','appVersion':'1.78','platform':'Android'})
        weird={**meta,'platform':'A "quoted" \\ name\nline'}
        output=self.common.version_script(TEMPLATE,weird)
        self.assertIn(json.dumps(weird['platform']).encode(),output)
        self.assertEqual(output,self.common.version_script(TEMPLATE,weird))
        for bad in (TEMPLATE.replace(b"'__PLATFORM__'",b'null'),TEMPLATE+b"'__PLATFORM__'"):
            with self.assertRaisesRegex(ValueError,'requires one quoted'):
                self.common.version_script(bad,meta)
        self.manifest['version']='0.12.78<script>'
        self.put('extension/manifest.json',json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError,'Invalid canonical'):
            self.common.version_metadata(self.root,'chrome')

    def test_chrome_and_firefox_archives_have_matching_versions_and_deterministic_bytes(self):
        self.common.FILES={'manifest.json','product-version.js','product-info.js'}
        self.common.LEGAL_FILES=set();self.common.MODEL_FILES=set()
        chrome=self.common.package(self.root,self.root/'chrome.zip'); first=chrome.read_bytes()
        self.common.package(self.root,chrome);self.assertEqual(first,chrome.read_bytes())
        with zipfile.ZipFile(chrome) as z:self.check({n:z.read(n) for n in z.namelist()},platform='Chrome / Chromium')
        firefox=load('package_firefox')
        with patch.object(firefox,'chrome_builder',return_value=self.common):
            output=firefox.package(self.root,self.root/'firefox.zip')
        with zipfile.ZipFile(output) as z:
            self.assertEqual(json.loads(z.read('manifest.json'))['version'],'0.12.78')
            self.check({n:z.read(n) for n in z.namelist()},platform='Firefox')

    def test_safari_development_archive_also_resolves_shared_version_template(self):
        safari=load('package_safari')
        self.put('extension/project-viewer.js', "$('previewHTML').onclick=async()=>{old();};\n $('stopHTML').onclick=()=>{};")
        self.put('safari/convert.sh','#!/bin/sh\n');self.put('docs/SAFARI.md','Safari fixture\n')
        with patch.object(safari,'FILES',{'manifest.json','product-version.js','product-info.js','project-viewer.js'}):
            output=safari.package(self.root,self.root/'safari.zip')
        with zipfile.ZipFile(output) as z:
            self.check({n:z.read(n) for n in z.namelist()},'web-extension/',platform='Safari development',version_path='VERSION.txt')

    def test_local_archive_includes_readable_root_version_and_served_metadata(self):
        local=load('package_local_viewer')
        with patch.object(local,'PYTHON',()):output=local.package(self.root,self.root/'local.zip')
        with zipfile.ZipFile(output) as z:
            data={n:z.read(n) for n in z.namelist()}
            self.check(data,'pocket_kiview/web/',platform='Local viewer',version_path='pocket_kiview/VERSION.txt')
            self.assertNotIn('VERSION.txt',json.loads(data['pocket_kiview/web/local-assets.json'])['files'])
            from kicad_vizdiff.local_viewer import asset_inventory
            z.extractall(self.root/'unpacked')
            self.assertIn('product-version.js',asset_inventory(self.root/'unpacked/pocket_kiview/web'))

    def test_android_packaged_assets_and_source_archive_separate_app_and_release(self):
        android=load('package_android');output=android.package(self.root)
        with zipfile.ZipFile(output) as z:
            prefix='android-app/app/src/main/assets/viewer/'
            data={n:z.read(n) for n in z.namelist()}
            self.check(data,prefix,app='1.78',platform='Android')
            self.assertEqual(data['VERSION.txt'],data[prefix+'VERSION.txt'])
            self.assertEqual(data[prefix+'about.html'],b'App 1.78; release 0.12.78\n')
            self.assertIn('VERSION.txt',json.loads(data[prefix+'shared-assets.json'])['assets'])

    def test_vsix_media_and_archive_versions_match_its_own_authoritative_manifest(self):
        vscode=load('package_vscode')
        manifest=json.loads((ROOT/'vscode-extension/package.json').read_text(encoding='utf-8'));manifest['version']=self.manifest['version']
        self.put('vscode-extension/package.json',json.dumps(manifest))
        self.put('vscode-extension/README.md','Fixture\n')
        for name in ('step-worker-vscode.js','load-worker-vscode.js','fast-pi-worker-vscode.js'):
            self.put('extension/'+name,b'worker')
        original=importlib.util.spec_from_file_location
        class WorkerLoader(importlib.abc.Loader):
            def create_module(self,spec):return None
            def exec_module(self,module):module.bundle=lambda root:b'worker'
        def spec(name,filename,*args,**kwargs):
            if name in {'build_step_worker','build_load_worker','build_fast_pi_worker'}:
                return importlib.util.spec_from_loader(name,WorkerLoader())
            return original(name,filename,*args,**kwargs)
        with patch.object(vscode,'ASSETS',('product-version.js','product-info.js')),patch.object(vscode,'BUILD_INPUTS',()),patch.object(vscode,'HOST_FILES',('package.json','README.md')),patch.object(vscode,'host_review_factory',return_value=b'host'),patch.object(importlib.util,'spec_from_file_location',side_effect=spec):
            output=vscode.package(self.root,self.root/'version.vsix')
            self.common.FILES={'manifest.json','product-version.js','product-info.js'}; self.common.LEGAL_FILES=set(); self.common.MODEL_FILES=set()
            chrome=self.common.package(self.root,self.root/'audit-chrome.zip')
            release=load('release')
            with patch.object(release,'module',side_effect=lambda name: self.common if name=='package_extension' else vscode):
                release.audit_packages(chrome,output,self.root)
                with zipfile.ZipFile(chrome) as original,zipfile.ZipFile(self.root/'tampered.zip','w') as changed:
                    for name in original.namelist():changed.writestr(name,b'wrong release' if name=='VERSION.txt' else original.read(name))
                with self.assertRaisesRegex(ValueError,'mismatch: VERSION.txt'):release.audit_packages(self.root/'tampered.zip',output,self.root)
        with zipfile.ZipFile(output) as z:
            data={n:z.read(n) for n in z.namelist()}
            self.check(data,'extension/media/',platform='VS Code')
            self.assertEqual(data['VERSION.txt'],data['extension/media/VERSION.txt'])
            self.assertIn('Version="0.12.78"',data['extension.vsixmanifest'].decode())
            inventory=json.loads(data['extension/media/shared-assets.json'])['assets']
            self.assertNotEqual(inventory['product-version.js']['sourceSha256'],inventory['product-version.js']['packagedSha256'])

    def test_hosted_web_archive_has_generated_about_data_and_root_version(self):
        web=load('package_app_web');self.put('app_web/index.html','<html>Fixture</html>')
        with patch.multiple(web,ROOT=self.root,SOURCE=self.root/'app_web',RENDERER=self.root/'extension',VENDOR=self.root/'extension/vendor',OUTPUT=self.root/'.vizdiff/app-web',ARCHIVE=self.root/'web.zip',PAGES=('index.html',),ASSETS=(),RENDERERS=('product-version.js','product-info.js')):
            web.package()
        with zipfile.ZipFile(self.root/'web.zip') as z:
            self.check({n:z.read(n) for n in z.namelist()},platform='Web viewer')

if __name__=='__main__':unittest.main()
