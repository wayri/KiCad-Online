"""Read-only, session-bound loopback host for the shared KiCad Online UI."""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
import webbrowser
from .http_limits import BoundedHTTPServer, DeadlineRequestHandler

MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_PROJECT_BYTES = 96 * 1024 * 1024
MAX_FILES = 512
TOUCHSTONE_SUFFIXES = frozenset(f'.s{port}p' for port in range(1, 33))
TEXT_SUFFIXES = frozenset({'.kicad_sch', '.kicad_pcb', '.kicad_pro', '.kicad_prl', '.kicad_dru', '.kicad_wks', '.json', '.csv', '.tsv', '.txt', '.wbk', '.raw', '.egres', '.html', '.htm', '.gbr', '.ger', '.gerber', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo', '.gtp', '.gbp', '.gko', '.drl', '.xln'})
ASSET_SUFFIXES = frozenset({'.step', '.stp', '.wrl', '.vrml', '.glb', '.pdf'})
SKIP_DIRS = frozenset({'.git', '.svn', '.hg', '.aws', '.agents', 'node_modules', '__pycache__', '.gradle', 'build', 'dist'})
WEB_SUFFIXES = frozenset({'.html', '.css', '.js', '.mjs', '.wasm', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.md', '.txt', '.json', '.bcmap', '.pfb', '.ttf'})


def safe_relative(value: str) -> bool:
    """A URL/project path is relative, portable, and never a hidden path."""
    if not isinstance(value, str) or not value or len(value) > 1024 or any(ord(c) < 32 for c in value) or '\\' in value or ':' in value:
        return False
    parts = value.split('/')
    return not any(not p or p.startswith('.') or p in {'.', '..'} for p in parts)


def contained_file(root: Path, relative: str) -> Path:
    if not safe_relative(relative):
        raise ValueError('Unsafe relative file path.')
    candidate = root.joinpath(*PurePosixPath(relative).parts)
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink() or getattr(current, 'is_junction', lambda: False)():
            raise ValueError('Linked paths are not read by the local viewer.')
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError('File is outside the selected root.')
    return resolved


def read_bounded(root: Path, relative: str, maximum: int = MAX_FILE_BYTES) -> bytes:
    candidate = contained_file(root, relative)
    with candidate.open('rb') as stream:
        before = os.fstat(stream.fileno())
        if before.st_size > maximum:
            raise ValueError(f'{relative} exceeds the {maximum // (1024 * 1024)} MiB file limit.')
        content = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    if len(content) > maximum or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError(f'{relative} changed while being read; save it and restart the viewer.')
    current = contained_file(root, relative).stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns):
        raise ValueError(f'{relative} changed while being read; save it and restart the viewer.')
    return content


def supported_text(path: Path) -> bool:
    suffix = path.suffix.lower()
    return suffix in TEXT_SUFFIXES or suffix in TOUCHSTONE_SUFFIXES or path.name in {'sym-lib-table', 'fp-lib-table'} or (suffix.startswith('.gm') and suffix[3:].isdigit()) or (suffix.startswith('.g') and suffix[2:].isdigit())


def project_snapshot(project: str | Path) -> dict:
    selected = Path(project).expanduser().absolute()
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (selected, *selected.parents)):
        raise ValueError('Select a real project directory or saved file, not a linked path.')
    selected = selected.resolve(strict=True)
    root = selected if selected.is_dir() else selected.parent
    root_file = None if selected.is_dir() else selected.name
    if root_file and not (supported_text(selected) or selected.suffix.lower() in ASSET_SUFFIXES):
        raise ValueError('Select a KiCad project, drawing or supported review file.')
    files, assets, warnings, entries = [], [], [], []
    inventory_truncated = False
    total = 0
    for folder, dirs, names in os.walk(root, followlinks=False):
        base = Path(folder)
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in SKIP_DIRS and not (base / d).is_symlink() and not getattr(base / d, 'is_junction', lambda: False)())
        for name in sorted(names):
            candidate = base / name
            relative = candidate.relative_to(root).as_posix()
            if not safe_relative(relative) or candidate.is_symlink() or not candidate.is_file():
                continue
            # List ordinary project files without reading arbitrary file contents.
            if len(entries) < 10000:
                entries.append({'path': relative, 'type': 'blob'})
            else:
                inventory_truncated = True
            if not (supported_text(candidate) or candidate.suffix.lower() in ASSET_SUFFIXES):
                continue
            if len(files) + len(assets) >= MAX_FILES:
                raise ValueError(f'Project exceeds {MAX_FILES} supported files; select a smaller project directory.')
            content = read_bounded(root, relative)
            total += len(content)
            if total > MAX_PROJECT_BYTES:
                raise ValueError('Project exceeds the 96 MiB snapshot limit; select a smaller directory.')
            if candidate.suffix.lower() in ASSET_SUFFIXES:
                assets.append({'path': relative, 'base64': base64.b64encode(content).decode('ascii')})
            else:
                try:
                    text = content.decode('utf-8-sig')
                except UnicodeDecodeError:
                    if relative == root_file:
                        raise ValueError(f'{relative} is not a UTF-8 source file.') from None
                    warnings.append(f'{relative}: omitted non-UTF-8 text file.')
                    continue
                files.append({'path': relative, 'content': text})
    if not files and not assets:
        raise ValueError('No supported project files found.')
    if root_file and not any(f['path'] == root_file for f in files + assets):
        raise ValueError('The selected file was not loaded.')
    # Identity describes this saved source snapshot; no account or path is exposed.
    identity = hashlib.sha256(json.dumps([files, assets], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    return {'name': root.name, 'id': 'local-' + identity[:24], 'files': files, 'assets': assets, 'rootFile': root_file, 'warnings': warnings,
            'repositoryTree': {'entries': entries, 'truncated': inventory_truncated}}


def asset_inventory(assets: Path) -> frozenset[str]:
    """Use the packager's explicit inventory; never serve a directory listing."""
    metadata = assets / 'local-assets.json'
    if metadata.is_file():
        document = json.loads(read_bounded(assets, 'local-assets.json', 1024 * 1024))
        names = document.get('files') if isinstance(document, dict) else None
        if not isinstance(names, list) or len(names) > 3000:
            raise ValueError('Invalid local web asset inventory.')
    else:
        source = Path(__file__).resolve().parents[1] / 'scripts' / 'package_extension.py'
        if not source.is_file():
            raise ValueError('Web assets need local-assets.json. Use the local-viewer package or a source checkout.')
        spec = importlib.util.spec_from_file_location('_kiview_extension_inventory', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        names = list(module.FILES | module.LEGAL_FILES | {'parsing.js', 'local-viewer.html', 'local-viewer.js', 'local-viewer.css', 'local-runtime.js', 'local-import.js', 'local-project.js'})
    allowed = set()
    for name in names:
        vendor_license = isinstance(name, str) and name.startswith('vendor/') and 'LICENSE' in Path(name).name
        if not safe_relative(name) or (Path(name).suffix.lower() not in WEB_SUFFIXES and not vendor_license) or name in {'manifest.json', 'local-assets.json'} or (Path(name).suffix.lower() in {'.json', '.txt'} and not name.startswith('vendor/')):
            # Browser packaging contains manifest.json and legal text; they are not
            # needed by the loopback UI. Never expose arbitrary text/config files.
            if name in {'manifest.json', 'LICENSE.txt'}:
                continue
            raise ValueError(f'Unsafe local web asset inventory entry: {name}')
        allowed.add(name)
    if 'local-viewer.html' not in allowed:
        raise ValueError('The local-viewer entry point is absent from the asset inventory.')
    return frozenset(allowed)


class LocalViewerServer(BoundedHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, project: str | Path, assets: str | Path | None = None, port: int = 0):
        self.project_path = Path(project).expanduser().absolute()
        self.snapshot = project_snapshot(self.project_path)
        self.snapshot_lock = threading.Lock()
        assets_path = Path(assets or Path(__file__).resolve().parents[1] / 'extension').absolute()
        if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (assets_path, *assets_path.parents)):
            raise ValueError('Select a real web assets directory, not a linked path.')
        self.assets_root = assets_path.resolve(strict=True)
        self.asset_names = asset_inventory(self.assets_root)
        contained_file(self.assets_root, 'local-viewer.html')
        self.session = secrets.token_urlsafe(32)
        super().__init__(('127.0.0.1', port), LocalViewerHandler)
        self.origin = f'http://127.0.0.1:{self.server_port}'
        self.url = self.origin + '/local-viewer.html?session=' + self.session


class LocalViewerHandler(DeadlineRequestHandler):
    server: LocalViewerServer

    def log_message(self, format, *args):
        # Request URLs contain a session capability; never log it.
        return

    def reply(self, status: int, data: bytes = b'', content_type: str = 'text/plain; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
        self.end_headers()
        self.wfile.write(data)

    def authorized_origin(self) -> bool:
        return self.headers.get('Host') == self.server.origin.removeprefix('http://') and self.headers.get('Origin') in {None, self.server.origin}

    def do_GET(self):
        if not self.authorized_origin():
            self.reply(403, b'Untrusted local viewer origin.')
            return
        parsed = urlsplit(self.path)
        name = unquote(parsed.path).lstrip('/')
        if name == 'api/project':
            session = self.headers.get('X-KiView-Session', '')
            if not secrets.compare_digest(session, self.server.session):
                self.reply(403, b'The local viewer session is required.')
                return
            try:
                with self.server.snapshot_lock:
                    snapshot = project_snapshot(self.server.project_path)
                    self.server.snapshot = snapshot
            except (OSError, ValueError) as error:
                self.reply(422, json.dumps({'error': str(error)}).encode(), 'application/json; charset=utf-8')
                return
            self.reply(200, json.dumps(snapshot, ensure_ascii=False).encode(), 'application/json; charset=utf-8')
            return
        if not name:
            name = 'local-viewer.html'
        if name not in self.server.asset_names:
            self.reply(404, b'Unknown viewer asset.')
            return
        try:
            data = read_bounded(self.server.assets_root, name, 64 * 1024 * 1024)
        except (OSError, ValueError):
            self.reply(404, b'Viewer asset unavailable.')
            return
        mime = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'}.get(Path(name).suffix.lower()) or mimetypes.guess_type(name)[0] or 'application/octet-stream'
        self.reply(200, data, mime)

    def reject_write(self):
        self.reply(405, b'The local viewer supports GET only.')

    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = reject_write


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Open saved KiCad sources in a read-only browser workspace.')
    parser.add_argument('--project', required=True, type=Path, help='Saved project file or directory')
    parser.add_argument('--assets', type=Path, help='Explicit packaged web assets directory')
    parser.add_argument('--port', type=int, default=0, help='Loopback port; 0 selects an available port')
    parser.add_argument('--no-open', action='store_true', help='Print the local URL without opening a browser')
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error('Port must be between 0 and 65535.')
    try:
        server = LocalViewerServer(args.project, args.assets, args.port)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(server.url, flush=True)
    if not args.no_open:
        webbrowser.open(server.url, new=2)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
