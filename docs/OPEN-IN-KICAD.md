# Download project files and drawings

The drawing toolbar has one **Download** button. Its compact popup provides the
whole saved repository revision as a ZIP, selected KiCad source files as a ZIP,
interactive PDF drawings, and the current drawing as PNG. Nothing opens in KiCad
automatically. The separate **Open in KiCad** ribbon button has been removed.

PDF can include all schematic sheets and PCB layouts, all schematic sheets,
selected drawings, or the current drawing. Source files come from the same pinned
revision. Incomplete inventories and exports above the size limits are rejected
rather than silently producing a partial project. Full remote ZIPs include assets;
selected-file ZIPs contain only the selected native KiCad sources. Whole-project
ZIP export for local workspaces is not yet supported by this popup.

PDFs contain vector geometry, searchable text, component fields and net links.
The app PDF viewer supports clicking and right-clicking parts to inspect saved
properties, plus net selection and navigation. Other readers vary in their support
for annotations and property menus. The export uses the browser's saved-source
renderer, not the KiCad CLI; review any rendering warnings shown in Export details.
Unresolved hierarchy connections do not acquire speculative cross-sheet links.

Limits: 64 PDF drawings, 256 source files, 8 MiB per source file and 32 MiB total
source data. A vendored font is embedded; no remote font or desktop helper is needed.

## Legacy optional desktop helper

The following setup describes the retained native messaging backend for legacy
clients. The current drawing toolbar does not invoke it. To open a downloaded
project, extract the ZIP and open its project file in KiCad manually.

## Windows setup

Requirements: Python 3.10 or newer, an installed KiCad distribution containing
`kicad.exe`, `eeschema.exe` and `pcbnew.exe` together, and the Pocket KiVi extension.
Use a trusted checkout or source archive of this project. From its root, run:

```powershell
python scripts/install_native_host.py --chrome-id YOUR_CHROME_EXTENSION_ID --kicad 'C:\Program Files\KiCad\9.0\bin\kicad.exe'
```

Replace the versioned KiCad path with your actual installation. Find Chrome's
32-letter extension ID in `chrome://extensions`; a development copy and a store
copy can have different IDs. For Edge use `--edge-id` and its ID from
`edge://extensions`. For Firefox use `--firefox-id` and the exact installed add-on
ID from `about:debugging#/runtime/this-firefox`. You may combine the options in one
invocation; repeat an option to authorize another explicitly trusted installation.
No wildcard extension access is granted.

The installer copies a standalone host and fixed configuration under
`%LOCALAPPDATA%\PocketKiVi\native-host`, then registers only those browsers in
**HKEY_CURRENT_USER**. It needs no administrator privileges and contacts no
network service. It never runs automatically when you import this package.
Keep the configured Python and KiCad installations available. Restart your browser
and use a legacy client that explicitly invokes the helper. A preflight checks the helper before downloading;
choose the ZIP save location when prompted. Canceling Save As does not launch KiCad.

The browser-facing host name is `dev.pocketkivi.kicad`. The Windows launcher uses a
fixed quoted Python command with isolated mode (`-I`), with no request-derived
arguments and no forwarded browser command-line arguments. Python batch launchers
are documented by [Mozilla's native messaging guide](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging#Windows_setup).
Registry discovery and framing follow [Chrome's native messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
Installed-browser startup must still be checked on each target browser/policy;
unit tests do not establish compatibility with a managed installation.

## Updating or removing the helper

The installer deliberately refuses an existing installation or registration.
To update, close the browser, remove the previous **Pocket KiVi helper only**,
then rerun the installer. Keep all downloaded projects.

In Registry Editor, remove only the host's keys for browsers you installed:

- `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\dev.pocketkivi.kicad`
- `HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\dev.pocketkivi.kicad`
- `HKEY_CURRENT_USER\Software\Mozilla\NativeMessagingHosts\dev.pocketkivi.kicad`

Then remove `%LOCALAPPDATA%\PocketKiVi\native-host`. Removing this helper does not
uninstall the extension, Python, KiCad or any project. No helper registration or
launcher is currently provided for Linux or macOS; download the ZIP, extract it
and open the selected KiCad file manually on those systems.

## Safety and limits

The helper accepts only a status request or an open-project request with a local
ZIP, repository identity, full commit hash and relative KiCad file path. It does
not accept commands, executable paths, tokens or URLs from the browser, and does
not run repository scripts or install dependencies. The installer fixes the KiCad
installation. When available, a same-directory/same-stem `.kicad_pro` or the
archive's only project opens in the project manager. Multiple unrelated projects
are not guessed: the selected `.kicad_sch` opens in Eeschema or `.kicad_pcb` in PCB
Editor instead. The originally selected file must always exist in the archive.

The ZIP central directory is streamed and counted before Python creates any ZIP
entry objects: its size is capped at 32 MiB and claimed/actual counts must agree.
ZIP64 and multi-disk archives are not supported. All ZIP members, including their CRCs and actual expanded sizes, are checked before
any project files are written. Limits are 256 MiB for the ZIP and each expanded
file, 1 GiB expanded total, 20,000 entries, and a 1000:1 compression ratio (with a
1 MiB small-entry allowance). Unsupported/encrypted entries, links/special files,
traversal, alternate data streams, reserved Windows names and case/Unicode path
collisions are rejected. Every extraction gets a new unique sibling folder; no
existing project is overwritten. A KiCad launch failure keeps the extracted copy
and returns its location. The original downloaded ZIP is never deleted.

The helper rejects network, linked and reparse-point source paths. Choose an
ordinary local folder if a redirected/linked location is rejected. Message input
is capped at 64 KiB and stdout contains only native-message frames. Exceptions are
replaced with bounded generic errors. The helper does not provide an isolation
boundary against other software already running as your Windows account, nor does
ZIP validation make arbitrary KiCad documents trustworthy. Use a maintained KiCad
installation and open projects from sources you trust. Repository/hash metadata
identifies the requested revision; it is not a cryptographic attestation of the
ZIP's contents.

## Developer checks

```powershell
python -m unittest tests.test_native_host -v
```

The tests mock KiCad process creation. They verify message framing, safe argument
routing, archive boundaries/collisions, CRC failure before extraction, size limits,
unique copies and preservation after launch failure. They do not register a host,
change the registry or launch KiCad. In a restricted test environment, point
`TEMP` and `TMP` at an existing writable task directory before running them.
