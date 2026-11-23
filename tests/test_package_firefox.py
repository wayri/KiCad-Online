import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_firefox', ROOT / 'scripts/package_firefox.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PackageFirefoxTests(unittest.TestCase):
    def test_archive_is_reproducible_and_all_entries_exist(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'firefox.zip'
            first = builder.package(output=output).read_bytes()
            self.assertEqual(first, builder.package(output=output).read_bytes())
            with zipfile.ZipFile(output) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                self.assertNotIn('service_worker', manifest['background'])
                self.assertNotIn('sandbox', manifest)
                self.assertEqual(manifest['browser_specific_settings']['gecko']['strict_min_version'], '140.0')
                for name in manifest['background']['scripts']:
                    self.assertIn(name, archive.namelist())
                for entry in manifest['content_scripts']:
                    self.assertEqual(entry['js'][0], builder.SHIM)
                    for name in entry['js']:
                        self.assertIn(name, archive.namelist())
                self.assertNotIn('importScripts(', archive.read('background.js').decode())
                self.assertNotIn('html-sandbox.html', archive.namelist())
                for name in archive.namelist():
                    if name.endswith('.html') and name not in builder.chrome_builder().LEGAL_FILES:
                        self.assertIn(f'<script src="{builder.SHIM}"></script>'.encode(), archive.read(name))

    def test_project_license_and_static_terms_are_included_unchanged(self):
        packed = builder.payload()
        self.assertEqual(packed['LICENSE.txt'], (ROOT / 'LICENSE').read_bytes())
        self.assertEqual(packed['terms.html'], (ROOT / 'extension/terms.html').read_bytes())
        self.assertNotIn(f'<script src="{builder.SHIM}"></script>'.encode(), packed['terms.html'])

    def test_provider_data_consent_is_explicit_and_has_no_ungated_optional_types(self):
        gecko = json.loads(builder.payload()['manifest.json'])['browser_specific_settings']['gecko']
        self.assertEqual(gecko['id'], 'kicad-visual-review@wayri.github.io')
        self.assertEqual(gecko['data_collection_permissions'], {'required': [
            'authenticationInfo', 'browsingActivity', 'personalCommunications',
            'personallyIdentifyingInfo', 'websiteActivity', 'websiteContent',
        ]})
        self.assertGreaterEqual(int(gecko['strict_min_version'].split('.')[0]), 140)
        self.assertEqual(json.loads(builder.payload()['manifest.json'])['browser_specific_settings']['gecko_android']['strict_min_version'], '142.0')
        self.assertNotIn(b'offscreen.createDocument', builder.payload()['credential-vault.js'])
        self.assertIn(b'supported: false', builder.payload()['credential-vault.js'])

    def test_pdf_uses_browser_native_renderer_without_a_modified_third_party_library(self):
        packed = builder.payload()
        self.assertEqual({name for name in packed if name.startswith('vendor/pdfjs/')}, {'vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf', 'vendor/pdfjs/standard_fonts/LICENSE_LIBERATION'})
        self.assertEqual(packed['vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf'], (ROOT/'extension/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf').read_bytes())
        self.assertEqual(packed['pdf-viewer.js'], (ROOT/'extension/firefox/pdf-viewer.js').read_bytes())
        self.assertIn(b'pdf-viewer.js', packed['pdf-viewer.html'])
        self.assertNotIn(b'.innerHTML', packed['analysis-viewer.js'])
        self.assertNotIn(b'vendor/pdfjs', packed['pdf-viewer.js'])

    def test_repository_html_cannot_execute_and_shared_source_is_unchanged(self):
        original = (ROOT / 'extension/project-viewer.js').read_bytes()
        packed = builder.payload()
        entry = packed['project-viewer.js']
        self.assertIn(b"frame.setAttribute('sandbox','')", entry)
        self.assertIn(b'documentFor(source,{interactive:false})', entry)
        self.assertNotIn(b'html-sandbox.html', entry)
        self.assertIn(b'interactive iBOM are disabled', entry)
        self.assertIn(b'<script src="html-preview.js"></script>', packed['project-viewer.html'])
        self.assertEqual(original, (ROOT / 'extension/project-viewer.js').read_bytes())

    def test_adapters_reject_contract_drift(self):
        for content in (b'', b'importScripts("a.js");\nimportScripts("b.js");', b'importScripts("../secret.js");'):
            with self.assertRaises(ValueError):
                builder.adapt_background(content)
        with self.assertRaises(ValueError):
            builder.adapt_project_entry(b'unknown preview code')
        with self.assertRaises(ValueError):
            builder.adapt_html(b'<html>changed entry</html>')

    def test_generated_event_page_messages_use_promises_and_session_tokens(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('Node required for event-page runtime integration')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = builder.payload()
            for name, content in data.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            probe = root / 'probe.cjs'
            probe.write_text(r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const manifest=JSON.parse(fs.readFileSync('manifest.json'));let listener;
function storage(){const values={};return {values,get:async key=>({[key]:values[key]}),set:async data=>Object.assign(values,data),remove:async keys=>{for(const key of [].concat(keys))delete values[key];}};}
const session=storage(),local=storage();
const browser={runtime:{id:'addon',getURL:name=>'moz-extension://addon/'+name,onMessage:{addListener:fn=>listener=fn}},storage:{session,local},action:{onClicked:{addListener(){}}}};
const context=vm.createContext({crypto:require('node:crypto').webcrypto,browser,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,console});
for(const name of manifest.background.scripts)vm.runInContext(fs.readFileSync(name,'utf8'),context,{filename:name});
assert.equal(context.chrome,browser);
const options={id:'addon',url:'moz-extension://addon/options.html'};
const hostile={id:'addon',url:'https://github.com/wayri/example'};
async function send(message,sender){return new Promise(resolve=>{assert.equal(listener(message,sender,resolve),true);});}
(async()=>{
 const denied=await send({type:'github-auth-set',token:'fixture-token-0123456789012345'},hostile);assert.equal(denied.ok,false);
 assert.equal(Object.keys(session.values).length,0);
 const saved=await send({type:'github-auth-set',token:'fixture-token-0123456789012345'},options);assert.equal(saved.ok,true);
 const status=await send({type:'github-auth-status'},options);assert.equal(status.result.configured,true);
 assert.equal(typeof session.values['github-review-token'],'object');assert.equal(JSON.stringify(session.values).includes('fixture-token-0123456789012345'),false);assert.equal(Object.keys(local.values).length,0);
 const cleared=await send({type:'github-auth-clear'},options);assert.equal(cleared.ok,true);assert.equal(Object.keys(session.values).length,0);
})().catch(error=>{console.error(error);process.exitCode=1;});
''', encoding='utf-8')
            result = subprocess.run([node, str(probe)], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
