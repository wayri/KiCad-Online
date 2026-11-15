# KiCad Online â€” Portable KiCAD Viewer

This hybrid Android app packages the shared KiCad schematic, PCB and approximate 3D viewer inside a native Java host. One APK adapts to phones and tablets. It requires Android 8 (API 26) or later and targets API 36. Source designs are read-only.

Portrait and landscape use the same open project without reloading the viewer. Rotation follows Android's **Auto rotate** setting; enable it to rotate automatically. Short landscape screens use compact side drawers and scrollable toolbars, while larger tablets support expanded panes. Focused comment inputs stay visible as the viewport changes.

## Open a project

For the browser extension in Firefox or a derivative, use the separate [Mozilla installation/deployment guide](../docs/FIREFOX.md). The current unsigned desktop Firefox ZIP is not the Android app and has not been accepted on Firefox Android. Use this APK for the phone/tablet experience now; the guide describes the future signed mobile-extension route without claiming present compatibility.

The home screen and project overview include [BoM & assembly tools](../docs/BOM-ASSEMBLY.md) and [offline engineering calculators](../docs/CALCULATORS.md). BoM tools support local assembly variants, build quantities, procurement and progress drafts, inert iBOM imports, and exported BoM Studio JSON/CSV.

- **Open a project folder** uses Android's storage picker and includes nested sheets and available local model files. Select the complete project folder rather than only its `.kicad_pro` file.
- **Open a file** supports individual drawings, project files and complete project ZIPs. A single file grants no access to its siblings.
- **Drive / cloud** opens Android's document picker. Choose Drive or an installed storage provider. For complete projects, select a ZIP containing the drawings, subsheets and models. This is not a direct Drive URL browser or separate Drive OAuth integration.
- **GitHub** supports public and authorized private repositories, native device sign-in and manual tokens. Private OAuth requests GitHub's broad `repo` scope; organization approval or SSO may be required.
- **GitLab** supports public/private GitLab.com and self-hosted HTTPS servers at the origin root, with server-scoped tokens or registered public OAuth clients using PKCE. Register callback `kicadvizdiff://gitlab-oauth` on the selected server. Publication needs the appropriate API permissions.

Online imports pin the revision and load supported drawings and models. They do not modify the repository. Branch/history comparison uses bounded native imports. External model lookup and approximate stand-ins retain the shared viewer's limitations.

## Project library and offline copies (v1.6)

Open **Menu > Your projects** for **All**, **Starred**, and **Offline** collections. Search matches project names, repository names and server names.

- **Bookmark current** saves a pinned GitHub/GitLab project link. Local projects are saved with their source copy because a bookmark cannot silently reopen a folder grant.
- **Save offline** keeps the loaded drawings and models inside the app. It does not create a file in Downloads or require a new login to reopen the saved copy.
- **Star / Unstar** changes membership in the Starred collection.
- **Remove offline copy** retains the bookmark and star; reopening then needs the online source.
- **Remove bookmark** removes its associated offline copy too. Original project files and local review notes remain unchanged.

Offline copies and library metadata use a separate AndroidKeyStore AES-GCM key. Snapshots are compressed and stored atomically in the app's no-backup directory. No account tokens are included. Source-only reopening removes remote transport metadata, so it reads local saved files. Explicit copies remain after account sign-out; clearing app data or uninstalling removes the library. There is no cloud library sync or automatic offline refresh.

An updated online bookmark retains the previous offline revision until **Save offline** is selected again. The library shows the actual saved revision rather than relabeling an older copy as a newer one. A project has a stable library identity across viewed revisions.

Limits: 200 bookmarks, 20 offline projects, 512 MiB total stored ciphertext, and 160 MiB serialized snapshot. These are additional to the 96 MiB original source/model import limit. Storage errors preserve the previous successful copy. Encrypted files depend on the device's app key and cannot serve as portable backups.

## ZIP export

**Export project ZIP** is separate from in-app offline saving. It writes supported original source and model files to a location chosen through Android's save picker. Credentials, app metadata and review records are excluded. The export is an ordinary unencrypted ZIP; private exports require an explicit native confirmation. Account sign-out cannot remove an exported file. Importing its ZIP works offline.

The export uses the imported project snapshot, not an alternate comparison revision. Native ZIP intake rejects unsafe paths, duplicates, symlinks, encrypted or unsupported entries, executable KiCad entries and malformed archives. Limits are 32 MiB per file, 96 MiB expanded supported content, 2,000 supported files, 4,000 ZIP entries and a 100 MiB archive container. Highly inflated entries are rejected.

## Touch workflow

The development drawing toolbar keeps **Search**, **Inspect**, **Fit** and
**Tools** directly reachable with captions and touch targets. Tools opens the
existing grouped tool sheet; secondary actions remain there instead of
duplicating the primary strip. Reopening the same drawing preserves its current
workspace. These changes have focused JavaScript coverage; installation and
physical-device acceptance of this update are pending.

The bottom tabs switch between Project, Schematic and Layout. Views/compare controls open from the header. The drawing toolbar provides Search, Fit, group Highlight, Comments and More. Drag pans; pinch zooms; double-tap enters a sheet; hold opens contextual actions. Phone panels slide up. Tablet panels support pinning and resizing. Back dismisses overlays before exiting and protects unsaved comment drafts.

Controls retain accessible labels with compact phone controls and larger tablet spacing. The native host handles system/keyboard insets, font scaling and modern Android Back callbacks. Light/dark themes and reduced-motion preferences are respected. Locally bundled SVG icons use short captions. Settings load on demand, file lists are bounded and searchable, and parsing uses workers with a safe fallback. No measured large-project speedup is claimed.

## Accounts and review

Tokens stay in native AndroidKeyStore-backed AES-GCM storage and never enter WebView JavaScript or web storage. Sign-out purges account credentials and active authenticated source, but preserves explicitly saved library copies. App backup is disabled. GitLab credentials are server-scoped. The WebView loads trusted packaged assets through WebViewAssetLoader; remote pages are opened outside the privileged viewer.

Review drafts remain local until explicitly published. GitHub Issues/Discussions and GitLab issues/issue discussions support thread readback, member suggestions, policy checks, screenshot upload and duplicate retry protection. Remote permissions and account registration still apply. Offline review is local; remote publication and thread updates need a connection. Offline drafts are not automatically merged into another revision's remote comments.

## Local review files for device, Drive and OneDrive projects

For a local project opened through Android's storage picker, open **Files > Review file** to export or import review JSON. Drive and OneDrive work when their installed Android storage providers expose the selected file. No separate cloud login or API permission is added. Save the review JSON beside the original project or its ZIP, then open the same source project before importing that review file on another device.

The review file preserves comment text, severity, all review states (open, closed, skipped, resolved and won't fix), tags, object/sheet identifiers, and point/area coordinates. A SHA-256 manifest binds it to the complete imported source and model file set, including paths and contents. Renaming, adding, removing or changing a source/model file requires a new review file; review notes are not automatically migrated between revisions. Generated Android import IDs may differ across devices.

Import previews the number of new and unchanged notes and requires **Import notes** before writing. It adds new notes and preserves existing ones. Divergent copies of the same note are rejected, even if one has a newer timestamp; resolve those copies deliberately before importing. Changes made after preview require another preview. Reopen the drawing's Comments pane to refresh imported markers. Keep the exported JSON as a portable backup; app data alone is not a portable backup.

Limits are 1 MiB per review JSON, 2,000 notes across the project, and 2,000 source/model files. Source/model data is bounded to 96 MiB for inline imports or 1 GiB for native disk-backed imports. Disk reading is restricted to the imported appassets manifest, with 64 MiB per PCB, 8 MiB per schematic/library and 32 MiB per other file/model; oversized individual models require reopening a smaller source set. Exact source contents must be available. This workflow exports ordinary, unencrypted JSON and may contain private review text or saved screenshots. It does not publish to GitHub/GitLab, edit KiCad source files, automatically update a cloud file, or synchronize comment changes. Save a new review file after changes and use Android's picker to choose its destination.

## Build and packages

For Google Play, follow [the submission and upload-key guide](../docs/play-store/SUBMISSION.md). `bundlePlayRelease` requires a production upload key supplied through environment variables and never falls back to debug signing. Ordinary `bundleRelease` remains unsigned when no key is configured. Keep signing keys outside this checkout and back them up securely. Play Console submission and approval are separate from GitHub releases.

From the repository root, stage assets with `python scripts/package_android.py`. Then set `JAVA_HOME` to a JDK 17+ installation, configure `ANDROID_HOME` for an Android SDK with API 36, and run `android-app/gradlew.bat -p android-app assembleDebug lintDebug bundleRelease` (or the shell wrapper on Linux/macOS). The project currently uses AGP 9.3 and Gradle 9.5.

Development output is `app/build/outputs/apk/debug/app-debug.apk`. The release bundle is `app/build/outputs/bundle/release/app-release.aab`; configure your own release signing for distribution. APKs in `dist` are development-signed, not Play Store releases. `dist/pocket-kivi-android-source.zip` includes source and staged assets, excluding build caches and `local.properties`.

## Verification

Version 1.6 was built and installed on the connected Samsung SM_A366E running Android 16. JavaScript tests cover local transport, hierarchy, provider isolation, review handling, touch navigation, library metadata, filters and native reply correlation. Packaging checks verify asset staging.

The isolated `LibraryInstrumentation` test uses its own temporary native directory. On-device checks verified encryption at rest, recreation/reopen, star persistence, stable revision identity, exact offline revision tracking, failed-save preservation, tamper rejection, and independent copy/bookmark removal (15 checks). Run it after `assembleDebugAndroidTest` by installing the app and test APK and invoking `adb shell am instrument -w dev.kicadvizdiff.android.test/dev.kicadvizdiff.android.LibraryInstrumentation`.

Phone/tablet browser fixtures verify presentation and interaction, not live provider authentication. Physical SAF/Drive interactions, keyboard behavior, long-press gestures, live account sign-in and remote publication have not all been accepted on-device. Large-project phone performance is not benchmarked. Saved geometry and unsupported renderer constructs retain the shared viewer's disclosed limitations.

## Version 1.7 visual actions
Larger icons and small captions distinguish source cards and project navigation. GitHub and GitLab buttons use locally bundled official Invertocat and Tanuki geometry. See the staged BRAND-ASSETS.md for provenance. Drawing controls retain full accessible labels and compact touch targets.

## Touch net selection

Tap a wire, pad or track to highlight its net. If several networks are within 14 screen pixels, a compact chooser lists their names and visible layers; selection uses the existing cross-highlight workflow. Hidden or isolated-out layers are excluded. Pan, pinch and long-press do not trigger this chooser. Tap outside menus to dismiss them; destructive confirmations and unsaved-draft decisions still require an explicit choice.

## Open links from Chrome and other apps

In Chrome, open a GitHub/GitLab repository or KiCad file page and choose **Share â†’ KiCad Online**. The app opens the provider dialog with repository and revision filled in. Tap **Add and open project**; private repositories use the existing provider account. A matching linked KiCad file opens after import. Existing review drafts stay intact until you choose to change projects.

Redirect buttons can use `kicadvizdiff://open?url=` followed by the URL-encoded HTTPS repository/file link. Chrome intent links can use `intent://open?url=ENCODED_URL#Intent;scheme=kicadvizdiff;package=dev.kicadvizdiff.android;end`. Browser restrictions may require a user tap rather than an automatic redirect.

Normal GitHub.com and GitLab.com HTTPS links are registered as unverified supported links. On Android 12+, these usually open in the browser unless the user enables the domains under **Android Settings â†’ Apps â†’ KiCad Online â†’ Open by default / Open supported links**. We cannot verify domains owned by GitHub/GitLab. Self-hosted GitLab uses Share or the app redirect scheme; the app does not claim every HTTPS host.

Home, tree, blob and raw file links are accepted. URLs with a slash-containing branch encoded as one segment retain it; otherwise verify/edit the revision field, since a web URL alone cannot separate an unescaped branch from the file path. Links cannot sign in, publish comments, change scopes or fetch arbitrary Drive URLs. Drive projects still open through the Android document picker as files/ZIPs.

## GitHub access and quota errors

Native API errors now distinguish exhausted primary quota (with approximate reset wait), secondary throttling/Retry-After, organization SSO, and access refusal. They state whether the failing request was authenticated. No remote error body, SSO URL or token is exposed. Repository import checks the remaining core quota after indexing, before spending one request per supported file; insufficient quota offers account sign-in or local ZIP opening. A GitHub login in Chrome is separate from the app's native account.

## Simplified GitHub sign-in (1.11)

Sign in opens a trusted browser Custom Tab automatically, reusing that browser's GitHub session. Only the short-lived user code is copied to the clipboard (marked sensitive), ready to paste if GitHub requests it. It is cleared after completion/cancel on return only if the clipboard still contains that same code. Tokens and the private device code are never placed on the clipboard. Open GitHub app tries GitHub Mobile when installed; unsupported handling falls back to the browser. GitHub Mobile does not provide a documented third-party seamless account handoff, so this remains GitHub's device authorization flow.

Android now polls authorization independently of WebView timers and rechecks on return. Pending device credentials are encrypted separately in Android Keystore storage, recover across activity/process recreation until GitHub expiry, and are purged on cancel/sign-out. The OAuth token is encrypted as soon as GitHub grants authorization; retrieving a profile name cannot delay acceptance or undo it on a temporary API/network failure. The button and account indicator update from native completion events. I have authorized â€” check now also refreshes status without starting a new authorization. Live account verification requires a connected device and user approval on GitHub.

## ZIP project import (1.12)

ZIPs are copied in bounded chunks to a private temporary cache file and removed when import succeeds, fails or is cancelled. The compressed archive limit is 512 MiB; extraction is selective, so unrelated images, manuals and backups are never decompressed and do not consume the supported-project byte budget. Nested repository paths are preserved. Supported KiCad sources and local 3D models retain the 32 MiB per-member, 96 MiB total and 2000-file limits used by the viewer. Archives are limited to 10000 directory entries, with path, duplicate, encryption, Unix symlink, CRC and supported-member compression-ratio checks. ZIP64 and multipart archives remain unsupported. Errors distinguish archive bytes, supported member bytes and total supported project bytes.

The production reader can be tested without a device by compiling `app/src/main/java/dev/kicadvizdiff/android/ZipProjectReader.java` and `tests/ZipProjectReaderTest.java` with Java 17+, then running `dev.kicadvizdiff.android.ZipProjectReaderTest`. Fixtures include an archive over 50 MiB with 110 MiB of excluded documentation, nested sheets, supported-file limits, corrupt CRC, traversal, case-duplicate paths, symlinks, cancellation and truncation. Device document-provider testing still requires a connected phone.

## Panel interaction (1.13)

Touch and pen gesture completion no longer trigger mouse hover auto-hide. Pointer, wheel and scroll interaction inside a pane cancels pending dismissal. Outside drawing taps still collapse unpinned panes, and mouse hover departure retains normal auto-hide. The Android adapter no longer closes panes merely because more than one pane is visible during a click.

## Long-press actions (1.14)

Opening a context menu no longer selects the pressed object or opens Properties. Choose Inspect properties explicitly to inspect that object. Comment on object retains its exact saved-object anchor and opens Comments directly. Normal taps keep their existing selection behavior.

## Back navigation (1.15)

Android Back first closes the active dialog/menu and then panels, with nested drawing frames consulted before the project shell. With no overlay active it uses the shared parent-sheet navigation, or non-root sheet history when a parent is unavailable. It never follows history back into a child after reaching the root. At the root drawing, Back shows the home screen while retaining the current project in memory; the app may exit on a subsequent Back at home. Draft protection runs before sheet/home navigation. Native Back only allows exit after an explicit false response from the ready trusted UI; missing adapters, exceptions and unexpected evaluation results do not exit the activity.

## Explicit text selection (1.16)

Drawing tools now offer Select text mode for readable UI text and Copy drawing text for selectable saved text from the active drawing. Text selection is off during normal navigation; context menus, buttons and navigation captions remain non-selectable even in selection mode. Input and comment fields always retain normal editing, copy and paste. Back closes the copy dialog first and exits selection mode before navigating sheets. Drawing text is read from saved visible text primitives, limited to 5000 entries and 256 KiB; it is not OCR or generated geometry.

## Readable explorer and BOM (1.17)

Explorer headings, filters and result rows no longer shrink under a small height budget. BOM content uses the outer pane scroll rather than multiple compressed lists. Phone BOM groups have spaced cards, 16px titles, wrapped footprint labels and 48px reference buttons; board analytics retain readable label/value spacing. The phone explorer can use 86% of the drawing-frame height and remains closable with Back.

## Touch button help (1.18)

Hold a button or explorer tab for 500 ms to show its title or accessible label as a tooltip. The hold does not activate the command; ordinary taps still do. Movement over 8 px, scrolling and pointer cancellation dismiss help. Tooltips use the active dialog when necessary, retain existing accessibility descriptions, disappear automatically after 3.5 seconds and can be dismissed with Back. Drawing long-press retains its context menu.

## Single project menu (1.19)

Embedded drawing toolbars hide their duplicate Menu button when an ancestor workspace provides the project/account menu. Standalone drawings keep their menu fallback. The main Menu and Views actions stay in the project header; drawing actions retain Search, Fit, Highlight, Comments and More.

## Selection modes (1.20)
Select offers All (smart), Part and Net in phone drawings. The web viewer provides the same selection dropdown. Smart ambiguity lists saved component references and networks, including a pad/pinâ€™s owning component. Group highlighting preserves mixed part/net selections and paired highlighting. Long-press context actions remain separate.

## Expandable phone sheets (1.21)
Phone dialogs, tools, properties, comments, explorer and ambiguity/context menus have a drag handle. Pull up/down to resize, tap to expand/reduce, or use arrow keys on the focused handle. Heights stay within the available viewport, including the keyboard. Dialog contents scroll independently without shrinking rows; desktop/tablet pane sizing remains unchanged.

## BoM and field copies (1.22)
Open More â†’ BoM manager for separate schematic/PCB part lists, grouped quantities, search, filters, ordering and procurement metadata. Management drafts are stored by project revision and saved identity; CSV/JSON export uses Android's destination picker. JSON import uses the native file chooser. Reused schematic sheet instances are not expanded into an assembly quantity.

Edit KiCad fields opens existing Value/custom fields only. Save field draft keeps changes in memory; Export revised project writes a new ZIP through the document picker. Original imported files, coordinates, identities and connections are unchanged. Related schematic/PCB parts and other symbol units are not synchronized. Reopen and validate the exported copy in KiCad. Creating new source fields, changing references/footprints/connectivity and live ERC/DRC are not implemented. See [native rule engine plan](NATIVE_RULE_ENGINE_PLAN.md).

### Compact viewer (1.23)

Drawing views use a compact toolbar and bottom navigation, with Menu and Views floating over the drawing. The PCB layer selector folds into a small chip and expands on tap. Panel headings and spacing are reduced while touch controls retain usable targets. Floating controls use subtle theme-aware translucency, opaque text and an opaque fallback. In the phone-sized browser fixture, the drawing rectangle occupies about 89% of workspace height; floating controls cover small portions of it. Device verification is pending while the phone is disconnected.

### GitHub-only field editing (1.24)

Existing Value/custom-field editing is available only for projects opened online from GitHub. Local files, offline snapshots and GitLab imports remain view-only. The editor still exports a revised ZIP copy and does not overwrite repository files.

## Android 1.27: sheets, phone panels and large GitHub projects

More â†’ All sheets opens a scrollable gallery of loaded schematic pages with saved sheet names and file paths above each page. Tap a page to enter it. Cross-sheet nets and selected groups use the existing highlight style and highlight matching headings. Reused sheet instances share one saved-file view. Pages render as they enter the viewport, and offscreen canvases are disposed. Back returns to the single-sheet view.

Phone tools and properties start as a smaller draggable preview. Library/accounts and current-project actions are separate. While writing a comment, secondary controls collapse so the text box and Save/Comment actions stay visible; settings return when editing loses focus. Comment text leads each card, with muted location/date metadata and distinct issue/discussion markers.

GitHub imports beyond the in-memory 32 MiB/file or 96 MiB/project threshold offer Download and Cancel. Download streams a commit-pinned copy into private app storage and automatically adds Your projects for one-tap reopening and starring. Public downloads support 256 MiB/file; private GitHub Contents API downloads support 100 MiB/file. Both support 1 GiB/project and 2 GiB total downloaded storage. Private files above the GitHub API limit and Git LFS sources are unsupported by this automatic download path. The active schematic hierarchy has a separate 512 MiB/512-file bound; an individual drawing still needs available device memory. Copies are view-only, unencrypted, remain after sign-out, and are removed with their offline library entry or app data. External ZIP export of these large copies is unavailable. GitLab and local ZIP/folder imports now offer the same disk-backed large-project path described below.

Verification: native debug APK build and lint succeeded; packaging tests and shared JS regressions passed. Synthetic phone-size checks confirmed named pages and a readable focused comment at 400Ã—440. Native disk-storage acceptance tests compile but were not run: no Android device was connected. Physical keyboard behavior and the full Marble download remain device acceptance checks.

### All sheets and net links

In Schematic, choose **All sheets** to see named pages together on one canvas with shared pan and zoom. Select a net in a drawing, then open All sheets: only matching pages remain, with dashed yellow intersheet airwires. **Show all sheets** clears the highlights and restores every sheet in the shared workspace. Links represent saved global-label and resolved hierarchical-pin connectivity; they are review overlays, not PCB routing or a full KiCad netlist. Reused sheet instances and unresolved buses retain the existing connectivity limitations.

### Analysis and simulation results

**Project â†’ Analysis & simulation** opens saved WayriCAD reports, thermal/PI maps, SI plots, mechanical mesh previews, KiCad workbooks and exported CSV/ASCII SPICE waveforms. Supported report files can also open on their own. Results are read-only and available in downloaded/offline projects; no solver is run on the phone. See [saved-result formats and limits](../docs/ANALYSIS_VIEWER.md).

## Android 1.30 verification

All schematic sheets share one pan/zoom canvas, with headings above each page. Selecting a connected net retains matching sheets and shows logical intersheet airwires. Phone drawing actions and Library/accounts are separate from active-project bookmark, offline and download actions.

Properties, comments and tools start as compact previews and expand from their drag handles. Handles survive asynchronous shared-viewer rebuilds. Focusing a comment expands the editor within the visible keyboard space, and preserves that state across pane reopening; comment bodies and threads use larger text than their grey location/date/state metadata. Issue and discussion pins use different shapes and severity borders.

Large public GitHub downloads use pinned raw source URLs without credentials, avoiding per-file API quota. The Download/Cancel prompt precedes disk-backed import. Downloaded projects appear in Your projects with their app-storage location, offline status, star and one-tap reopen. Removing or replacing an offline entry clears its old disk copy and location label.

Verification includes JavaScript regressions, Android build/lint and native test compilation, plus a local phone-width viewer with two sheets, connected-net airwire and keyboard-sized comment layout. These checks do not establish physical keyboard/device behavior or a successful live authenticated private-project transfer. Native device tests remain pending.

## Android 1.31: 3D Layout selection

Layout has a direct 3D / 2D toggle in its compact toolbar. Part, net and group selections transfer into the 3D view and remain selected on returning to 2D. 3D picks update the shared properties panel and schematic/layout cross-selection. Search and connected-net controls remain available; Fit and zoom act on the active camera. Pinch, pan and cancelled gestures do not pick a part.

The preview uses saved front/back copper, vias, footprint stand-ins and local repository models. Inner-layer copper is not rendered by this 3D engine. Cross-highlights use up to 2,000 visible bounds and disclose larger selections; stand-ins remain identified approximations. This feature does not edit the design or run KiCad.

## Large imports and temporary downloads

GitHub, GitLab and local ZIP/folder/file imports offer **Download and keep**, **Temporary download**, and **Cancel** when the in-memory import budget is exceeded. Disk-backed copies support 256 MiB per supported file, 1 GiB per project, 2,000 supported files and 2 GiB combined stored downloads. ZIP containers support 1 GiB and retain CRC, traversal, duplicate, link, encryption and compression-ratio validation. Private GitHub still uses its 100 MiB Contents API limit; Git LFS pointers require a downloaded local checkout. These provider restrictions are not removed by increasing device storage limits.

Temporary copies live in the app-private `temporary-projects` directory with a configurable 30-minute to six-hour expiry (six hours by default). Recent projects show their expiry; they reopen until that time. **Save offline / Keep offline** explicitly creates a permanent copy. Temporary projects cannot be starred or bookmarked as permanent without keeping them. The active project menu also offers a temporary download for an ordinary online project. Set the duration under **Your projects → Temporary downloads**; changes apply to new copies. Optional local notifications offer **Keep** or **No** after 80% of the saved lifetime. Keep saves a permanent app-local copy; No, dismissal and no response leave expiry unchanged. Android can delay notifications and physical cleanup. See [Temporary downloads](../docs/TEMPORARY-DOWNLOADS.md).

Inexact Android alarms clean expired temporary source files and recent-entry snapshots. Android may delay background execution; expired copies are denied immediately by the native file server and project library, with cleanup also on app startup/resume. Expiry while the app is open closes the expired viewer. Saved permanent copies and original input files are preserved. Temporary and large permanent copies are unencrypted in private app storage; sign-out does not delete saved copies.

Verification for this change: complete JavaScript suite, bounded-heap production ZIP reader checks, Android compilation/lint, and native lifecycle/transport instrumentation. All 84 native instrumentation checks passed on a disposable Android 16 emulator; the 32 ZIP-reader checks ran with a 64 MiB JVM heap, and all 867 JavaScript tests passed. Live provider/SAF acceptance on a physical phone remains separate.
# Android 1.35 presentations

Open Project actions (or drawing tools) and choose **Present project** for a live
walkthrough, or **Create slides** for a saved deck. Walkthroughs hide viewer chrome,
keep pan/zoom/selection, offer previous/next sheets and board switching, and keep
the screen awake. Exit, Android Back or Escape restores the viewer.

Slide creation captures schematic or 2D PCB views, with editable titles and notes,
reordering and removal. Decks are saved per project on this device, with up to 30
slides and 12 MiB of encoded screenshots. Storage errors preserve existing slides.
**Export presentation** saves standalone HTML with its images, notes and navigation;
no account or network connection is needed to present the exported file. 3D can be
presented live; 3D slide capture is not supported.

Verified: 96 app-web tests, Android build/lint, browser fixture capture/edit/playback
and exit restoration, plus Android 1.35 installation on the connected Galaxy A36.
Native document-picker export and prolonged physical-device gesture acceptance
have not been exercised.

# Android 1.34 interaction refinement

The home screen groups local and online project entry points, followed by recent projects.
GitHub and GitLab dialogs show the repository link first; revision selection and permission
details are expandable. The three-step Quick start appears on first launch, can be skipped,
and can be replayed from home or the library menu. External project links do not interrupt
the user with the introduction.

Long holds on buttons show help without activating the button on release. Moving, scrolling,
outside touches, Back and Escape dismiss help; inputs, selects and output fields retain their
native interaction. Drawing tool toggles and navigation keep their sheet open, while pane
launch actions dismiss it. Field focus expands phone sheets above the keyboard.

Verified: 84 app-web tests, Android debug build and lint, phone/tablet browser checks for
home, guide and repository entry, and an update installation on the connected Galaxy A36.
Full physical-device gesture and keyboard acceptance remains a user verification step.
## Secure WebView requirement

Native file and provider access requires Android System WebView support for the origin-bound WebMessageListener API. Unsupported WebViews keep native access disabled and display an update notice. The native dispatcher accepts the packaged main frame only; imported downloads are inert data and cannot be navigated as frame documents. See [security safeguards](../docs/SECURITY.md) for the boundaries, checks and device-validation limitations.

## Foldable screens

The Android app observes fold posture and hinge bounds with Jetpack WindowManager. Cover screens and unfolded continuous screens use the existing responsive phone/tablet layout. A separating book or tabletop hinge confines the workspace and dialogs to the larger usable display region so controls and drawings do not land under the hinge. Unfolding restores the full workspace without replacing the viewer or clearing its project and review drafts. This version uses one display region when a hinge separates the window; it does not automatically create two viewers across the hinge.

Fold support follows the actual application window, including multi-window resizing, rather than assuming a particular phone model. Validation includes synthetic book/tabletop hinge geometry, keyboard viewport changes and native build checks. Physical foldable-device acceptance is still required.


## Repository navigation and app settings

**Files & actions** opens a collapsible repository tree with file/folder search, available model labels, and shortcuts for project overview, comments, offline saving and ZIP export. Imported drawings open directly; other online repository files open at the pinned commit in the external browser. **Browse branches** and **Current file history** use the connected provider and require an explicit selection before importing another revision. Unfinished comment editors are protected when changing drawings from the tree.

The online tree includes metadata for unsupported files without downloading them into the viewer. Listings are capped at 10,000 entries and disclose omissions. Local, offline and older cached downloads can show only their imported files. Branch/history requests use existing provider permissions and limits.

**Menu > Settings** stores appearance, drawing colors, ruler units and 2D acceleration on this device. KiCad-style presets use light schematics and dark PCBs, with separately selectable light or dark app chrome. Settings apply to newly opened and nested drawing views.

Comment posting uses a single destination selector for the provider's supported new/existing Issues, Discussions and current pull request where available. Publication still requires final confirmation.

The 3D viewer loads supported STEP/STP, WRL/VRML and GLB assets from imported repository files. Standard KiCad model-directory variables can resolve against a unique matching repository suffix; ambiguous paths remain unavailable. Supported embedded board/footprint models are decoded with bounded Zstandard handling and checksum validation. Missing models remain disclosed stand-ins; unsupported geometry and oversized assets do not become accurate models merely because a reference exists.

## Provider boards, publisher sign-in and 3D graphics

Comments → conversation options → Work board opens linked GitHub Projects or
GitLab project label boards. GitHub sign-in can include Projects permission.
Status updates use provider fields, preserve unrelated GitLab labels, and reject
stale statuses. Board operations remain bound to the active imported project.

GitLab sign-in resolves the publisher's public Application ID from packaged
configuration. Ordinary users do not register applications. The publisher (or
self-hosted administrator) configures a public OAuth application once; see
[GitLab publisher setup](../docs/GITLAB-PUBLISHER-OAUTH.md). Without that release
configuration, the app explains the missing setup and keeps the token alternative
under Advanced. No client secret is packaged.

The comment composer supports mixed text/image paste and an Attach image picker
under + for mobile keyboards without image paste. Both use the same bounded PNG
normalization, source attachment and destination confirmation.

3D uses hardware-accelerated WebView WebGL and capability-based quality budgets,
with PBR lighting, tone mapping, real linked models, ambient occlusion and enhanced
antialiasing where supported. [3D diagnostics and acceptance](../docs/ANDROID-3D.md)
distinguish emulator rendering checks from physical-phone GPU performance.

## Repository website session (Android 1.83 beta)

In **GitHub**, enter an `owner/repository` name and choose **Open through browser ·
no repo OAuth**. Sign in inside that panel, complete any organization SSO, navigate
to the project folder, then choose **Use project**. Files are read through that
website session, pinned to an immutable commit and imported into app storage as a
temporary project. **Files > Repository browser** reopens the panel. Phones use an
expandable bottom sheet; tablets use a side panel.

This browser has its own session, separate from Chrome. Where Android WebView
supports multiple profiles it also uses a separate cookie/storage profile; older
WebViews use a bridge-free instance in the app's default profile and disclose that
fallback. Remote pages have no native JavaScript bridge, local file/content access,
credential export or certificate-error bypass. Only packaged scripts perform
bounded operations in the selected GitHub.com repository. No broad repository
OAuth grant or account API is used by this transport. External SSO origins require
explicit approval; some identity providers prohibit embedded sign-in. This does
not override organization access, download or device policies.

For an imported website-session project, Comments can list/read existing Issues
and send replies through GitHub's rendered composer. A native confirmation shows
the destination and message before sending. The account, selected project and
pending draft are checked again at Send. Confirmed receipts prevent duplicates;
uncertain outcomes require checking the Issue rather than automatic resending.
Point/area/sheet/revision metadata travels in the comment body and can reconstruct
matching drawing markers on readback. Refresh uses bounded foreground polling,
not a real-time service. New Issues, Discussions, attachments and Issue state
changes are not implemented by this session adapter; use the website for those.
GitLab and GitHub Enterprise Server need separate website-session adapters.

Drive, OneDrive and other Android document providers use **Drive / cloud** or
**Open files** instead. Import a complete project ZIP and keep its portable
**Files > Review file** JSON beside it. That sidecar retains comment states,
severity and point/area locations. Import/export is explicit; there is no cloud
account integration or automatic sidecar synchronization.

Comment synchronization uses a small inline status in the conversation. Review
reads, including GitLab reads, do not open the global project-loading popup.

Verification for this beta: all 2,360 JavaScript tests, 121 native URL-policy
checks, Android build/lint, and 21 synthetic physical-phone browser checks passed.
The phone also read the public `wayri/KiCad-Github-View` sensor PCB at a pinned
commit and confirmed a separate WebView profile. Synthetic checks cover direct
reply, reverse readback, duplicate/stale-draft rejection and streamed import;
they send no real comments. Live organization SSO, real account posting, Drive/
OneDrive provider interactions and tablet hardware acceptance remain unverified.

## Android 1.85 contact selection and result display

In Fast PI, choose a net and use **Source** or **Load** to search its saved
component pads. Suggestions show the reference, pin number, layer and exact
coordinates. Each contact can be cleared or picked again independently. Board
taps remain available; ambiguous taps offer candidates rather than choosing a
different conductor silently. The chooser uses a bottom sheet on narrow screens
and a compact panel on wider screens, retaining its state through rotation.

**Smooth field** is the default result display. It interpolates accepted mesh
samples and clips the image to saved copper, drill voids and solved cells.
**Mesh diagnostic** exposes the underlying discretization. Current, density and
loss fields interpolate mean incident edge values; they do not add simulation
resolution. Refine the mesh before relying on extrema. Unsupported masking is
reported and falls back to the mesh display.

Draftsman PDF, SVG and editable JSON downloads use Android's document save picker.
Cancellation keeps the document open. Mobile export limits are 16 MiB for PDF,
8 MiB for SVG and 4 MiB for JSON.

## Android 1.84 mobile engineering fixes

Draftsman remains a full-screen drawing editor rather than an Android peek-height
bottom sheet. Tools, Properties and Save/export overlay the sheet on phones;
Fit sheet accounts for both available width and height, including landscape.

Fast PI captures contact taps before ordinary net selection and reduces its panel
while picking so the drawing remains reachable. It uses the packaged worker for
experimental fixed-temperature DC copper screening. Enter reviewed voltage,
current, material and stackup values; it is not a thermal or return-path solve.

Physical-phone acceptance: 22 checks passed using a synthetic saved copper-strip
board, including native source/load taps, the packaged worker, immediate results
and portrait/landscape Draftsman fitting. At 2 A the strip returned 8.867 mV drop,
matching the analytical copper resistance within 1 µV. Android build/lint and
all 2,361 JavaScript tests passed. This does not benchmark large-board solving or
establish tablet hardware acceptance.

## Demo board acknowledgements

Thanks to the authors and contributors of OLIMEX ESP32-PoE, Berkeley Lab Marble, Ttl/FMCW3 and KiCad’s PIC Programmer demo for the public designs used in the shared viewer examples. See [board credits, recorded revisions and capture limits](../docs/DEMO-BOARD-CREDITS.md). Design and model licenses remain with their respective upstream sources; no affiliation or endorsement is implied.
