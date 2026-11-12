# KiCad Online user guide

Open saved KiCad projects, inspect schematics and layouts, and record review or assembly findings without a KiCad installation. Design sources are read-only during ordinary viewing. Review notes, assembly progress and variants are separate data; the VS Code conflict resolver is an explicit exception that can write a resolved drawing after confirmation.

For the illustrated Android, VS Code and Chrome walkthrough, start with the [main repository user guide](../USER-GUIDE.md). This reference describes current source capabilities; check the release notes and installed version. Host differences are called out below.

Start with the [installation guide](INSTALL.md) for Android, Windows, Linux and macOS. Check the [KiCad compatibility matrix](KICAD-COMPATIBILITY.md) before reviewing a new file format. Recognized KiCad 8, 9 and 10 constructs use the shared viewer; coverage is narrower for 8/9, and newer constructs may display warnings or incomplete previews.

## 1. Open a project

### Android

1. Choose **Open a file** for a drawing or project ZIP, or use the Android document picker for an available storage provider.
2. Prefer a complete project ZIP when the design includes subsheets, libraries or component models. Selecting one drawing does not grant access to its sibling files.
3. For a repository, use the GitHub or GitLab import controls. Public projects can be read without a connected account; private projects need authorized access through the app's account connection.
4. Use **Menu → Your projects → Save offline** to retain the loaded revision. Reopen it from **Offline** without a network connection. Save offline again after importing a newer revision; stored copies do not refresh automatically.

Offline copies belong to the app and disappear when app data is cleared or the app is uninstalled. **Export project ZIP** creates a separate, unencrypted file containing supported source/model files, without review metadata or credentials. Back up review state separately. See the [Android guide](../android-app/README.md).

### Firefox and Firefox derivatives

Install through [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/pocket-kiview-kicad-review/), or follow the [Firefox guide](FIREFOX.md) for temporary desktop previews, Firefox-based browsers and Android limits.

### Chromium browser extension

Open extension Options and choose **Open local KiCad workspace**. Use **Open files**, **Open folder**, or drag files/a folder into the workspace. Folder import preserves relative paths so subsheets and models can be found. If directory dragging is unsupported, use **Open folder**. Local imports stay on your computer and can be viewed offline after installing the extension.

Enable **Parallel views** and choose a drawing for each pane to inspect schematic and PCB together. Matching saved part/net identities support cross-probing. Reimport browser-picked files after changing them externally: the viewer holds a saved snapshot. The optional loopback launcher has a separate **Reload saved project** action. See [local browser workspace](LOCAL-VIEWER.md).

Opening a project starts in its matching schematic, or its sole identifiable schematic. A PCB-only project starts in layout. Explicit drawing links keep the requested file. When several schematics could be the entry sheet, choose one from the project files. Settings and other project files remain available from **Project**.

For online review, open a supported GitHub/GitLab repository file page. Allow the extension access to the intended host. Private browser-session reads have provider-specific limits; publishing remote reviews requires a connected account and permissions. See [Git hosts and accounts](GIT-HOSTS.md) and [GitHub sign-in](GITHUB-SIGNIN.md).

### VS Code

1. Open the folder containing the project.
2. Select a `.kicad_sch` or `.kicad_pcb`. If it opens as text, choose **Open With… → KiCad Online**, or run **KiCad: Open Visual Viewer** from the Command Palette.
3. Use the **KiCad Review** Explorer section to change drawings. Run **KiCad: Open Paired Schematic and PCB Review** for a companion editor.
4. Close and reopen a drawing after external edits. Run **KiCad: Refresh Review Navigator** after adding project files.

Desktop local-file review works offline. Web extension hosts depend on the files and permissions supplied by their workspace provider. See the [VS Code guide](../vscode-extension/GUIDE.md).

## 2. Navigate and inspect drawings

- Search for a reference, value or net; use **Explorer** for parts, nets and layers, and **Inspect** for saved properties.
- In schematics, open a child sheet and return to its parent with sheet navigation. **All sheets** provides a project-wide overview when the required sheets are available. See [sheet navigation](SHEET-NAVIGATION.md).
- In layouts, toggle layers, flip the board, or focus a copper layer. Show/hide side panels to regain canvas space on a phone.
- Select a part or net to highlight matching saved geometry. Paired views can follow matching selections; ambiguous or incomplete identities limit cross-probing.
- Enable **Net names** in Layers for labels on supported straight tracks and filled copper polygons. Labels depend on visible layers, saved net data and available space. They are display overlays, not connectivity changes. See [copper net names](copper-net-names.md).
- Open 3D for board geometry and available supported models. Import models with the project; missing external libraries or unresolved paths are not supplied merely by installing KiCad. The VS Code guide lists workspace model formats and limits.

Rendering warnings matter: a visible preview is not proof that every source construct was interpreted.

## 3. Measure, probe and review board data

Choose **Measure** in a drawing, then select two points for a distance. Measurement options include angle, geometry/grid snapping, units and saved board extents. For an angle, select endpoint → vertex → endpoint. Choose **Corners only** or **Edges only**, and use **Targets** to limit snapping to the board outline, pads/pins, vias, tracks/wires, graphics or symbols. Hidden geometry is excluded. Track/wire and graphic-line edges use saved centerlines, not an inferred copper-clearance boundary. Desktop **Shift** constrains an axis and **Alt** bypasses snapping.

On a phone, press and drag in measurement mode to preview a point in the magnifier, then release to place it. The magnifier can be disabled in measurement options. Cancellation or a second touch does not place a point. Exit measurement mode to return to ordinary drawing navigation.

In 3D, choose surface, edge or corner snapping and filter the target object types. Snaps use visible rendered geometry with occlusion checks; imported model precision follows its tessellated mesh. Stand-in models remain marked approximate. The touch magnifier assists drag-to-place while keeping saved coordinates as the measurement source. Measurements inspect the saved drawing/model and do not run mechanical clearance validation.

Use **Highlight testpoints** (pin icon) to highlight candidates on the active drawing. Toggle it off to retain your existing part/net selection. The overlay shows up to 200 testpoints; all remain searchable. In Explorer, choose **Testpoints** to filter the current drawing and focus its search field. Rows include saved net names; search by reference, value or `net:SENSE`. These actions are shared by Android, Chrome and VS Code.

Open **Testpoints & nets** to search candidate testpoints and their saved nets. Select a row to locate it in the drawing and export CSV for a bench checklist. Check classifications and connections against the actual board before probing.

**Board analytics** summarizes saved track lengths, zone polygon areas and routing/placement review candidates. Imported **ERC/DRC** reports can show findings and markers. These controls do not run native KiCad checks, refill zones or establish manufacturing readiness. Candidate airwires and placement flags are not native unrouted/unplaced counts.

## 4. Use the BoM field table

Open **BoM & assembly** in Android/browser project tools, or the drawing's **Open BoM manager** / **Assembly** controls. VS Code supplies the drawing manager; standalone imported BoM/iBOM pages belong to Android and the browser extension.

1. Filter parts by reference/value/field text, population, side or progress.
2. Open **Fields** to choose table columns. The phone table scrolls horizontally while keeping its first column and headers visible.
3. Enable grouping by **Value**, **Footprint**, **Value + footprint**, **Rate** or custom fields. Rate uses entered unit price and currency; missing prices are not zero. Different fields show `<mixed>`.
4. Select a reference to locate its saved object. Use **Manage** to enter procurement fields and local assembly progress. Editing a grouped row affects its listed parts; ungroup for individual control.
5. Export visible CSV for the current columns/groups, and metadata JSON to preserve local management drafts. Export before clearing storage or moving devices.

Saved design fields remain read-only. Management drafts are scoped to the saved source/revision and variant. Prices are entered locally; there is no live purchasing or currency conversion. Repeated hierarchical instances are not expanded into manufacturing quantities. See [BoM and assembly](BOM-ASSEMBLY.md), [field table and grouping](bom-field-table.md) and [supported import formats](BOM-IMPORT.md).

### Variants and DNP/DNI

Use **Manage variants** to create/import a review variant and stage fitted/DNP, Value, Footprint or MPN overrides. Choose **Save variants** to retain edits. The selected variant affects BoM quantities and supported population overlays without changing the source drawing.

Enable **DNP / DNI** in PCB drawing tools to highlight omitted footprints. BoM exclusion alone does not mean DNP. Imported BoM Studio exports describe the exported variant; they cannot reconstruct variants omitted by the producer. See [variants](variants.md).

### Reset progress or management fields

Export metadata first if you may need to restore it. Then choose:

- **Manage → Reset saved fields…** for one part or grouped row.
- **Reset progress / fields → Reset matching parts…** for the complete filtered result.
- **Reset entire source…** for the current source, including DNP/excluded parts.

The warning lists the affected identities and count. Choose assembly progress, procurement status, or all local management fields; acknowledge the warning before confirming. Changing the mode clears acknowledgement. Assembly resets to `not started`, procurement to `not ordered`; resetting all fields removes local overrides so original saved fields reappear. Cancel writes nothing. Source drawings and variant definitions are unchanged. Full details: [reset warning and scope](bom-field-table.md#reset-saved-management-fields).

## 5. Open fabrication files, documents and results

| Tool | Workflow and boundary |
| --- | --- |
| Gerber viewer & analyzer | In Android/browser, import fabrication layers and Excellon drills, toggle films, adjust opacity, measure, and export analysis JSON. Parsed bounds, stroke widths and drill findings are screening data, not complete DFM. Unsupported macros, transforms and slots are reported. VS Code provides inline Gerber/drill inspection, not the standalone analyzer page. [Gerber guide](GERBER-VIEWER.md). |
| PDF viewer | Android/browser: choose a PDF from project files or **PDF viewer**. Navigate pages, fit/zoom/rotate, use bookmarks, text search and extracted text. Scans need an existing text layer for search. No PDF editing, OCR or signature verification. This standalone page is unavailable in VS Code. [PDF guide](PDF-VIEWER.md). |
| Analysis & simulation | Android/browser: open a saved report from project tools. Choose Graphs, Data, Report or Source; use available traces and A/B probes. Supported spatial exports offer 2D/3D overlays. A PCB attachment requires an exact saved source binding; missing spatial data is not guessed. This viewer reads results and does not run solvers. VS Code does not open the standalone graphical results page. [Formats and probing](ANALYSIS_VIEWER.md). |
| Calculators | Android/browser: open **Calculators**, choose a circuit/tool and enter values in the displayed units. Inspect its diagram, calculated outputs, assumptions and warnings. Standalone calculator pages are unavailable in VS Code. [Calculator guide](CALCULATORS.md). |

KiCad simulation workbooks contain setup rather than waveform samples. Export CSV/TSV or supported ASCII RAW data from the simulation tool to inspect actual saved waveforms. Binary RAW is unsupported.

### WayriCAD simulation results

1. In WayriCAD / kiWay, save or export the result and its numerical data. Supported producer formats include quickTherm full JSON, quickPI mesh/result bundles and transient waveforms, and quickSI saved traces/reports. An HTML report alone may not contain the samples needed to recreate a plot.
2. Include the saved exports in the project folder/ZIP, or open a supported report directly. In Android use **Project → Analysis & simulation**; in the browser use **Analysis** in the project viewer.
3. Choose **Graphs**, **Data**, **Report** or **Source**. Select a trace or saved frame and use the available probes to inspect values. Supported spatial fields offer 2D/3D overlays; waveform-only results remain plots.
4. To attach spatial results to a PCB, include the exact board referenced by the result's saved source hash and the required coordinate/layer metadata. A different board revision is not silently substituted. Without an eligible board binding, inspect the standalone saved field.

This cross-compatible workflow displays saved exports; it does not launch WayriCAD solvers, synchronize live sessions or promise every producer version/schema. Include result files in the offline project copy to review them without a network connection. The standalone results viewer is available in Android/browser, not currently in VS Code. See the [format matrix and producer evidence](ANALYSIS_VIEWER.md#verified-formats).

## 6. Record, share and transfer a review

Use **Review** / **Comments** to anchor a note to a drawing object, position or area. Add severity, tags and state; review the destination and any image before publishing. Saving a local draft does not post it.

In the browser and supported app flows, GitHub Issues/Discussions and GitLab issues/issue-discussion threads require authorized account access. GitLab issue discussions are not standalone GitHub-style Discussions. Remote history/readback differs by host; use the [comments guide](COMMENTS.md) and [Git host matrix](GIT-HOSTS.md) for exact scope. Local state changes do not automatically close remote issues.

VS Code writes annotations to a `.kicad-review.json` sidecar. Inspect it in Source Control and commit it with normal Git tools to share it. In a trusted local checkout with a matching supported Git remote, connect an account to read conversations and explicitly publish supported notes and screenshots to GitHub/GitLab. Pinned annotation publication/readback requires the displayed sources to match committed Git blobs. Assembly drafts use separate local storage.

Use portable review export/import to transfer supported notes, BoM metadata, variants and 2D view/measurement state. Open matching source drawings on the destination first: import checks paths and content fingerprints. Portable reviews do not include CAD sources, original photos, model files, credentials or entire remote conversations. Export is explicit transfer, not device synchronization.

For photo-assisted assembly review, import top/bottom photographs, align known component centers and inspect matched references. Population suggestions require reviewed reference photos and manual confirmation; the overlay does not track camera movement. See [photo alignment and testpoints](PHOTO-AR-TESTPOINTS.md) and [population inspection](POPULATION-INSPECTION.md).

## 7. Resolve a Git conflict in VS Code

1. Select a marker-conflicted `.kicad_sch` or `.kicad_pcb` and run **KiCad: Resolve Git Conflict Visually**.
2. Inspect **Current** and **Incoming** with linked cameras and saved-object difference highlights.
3. Choose **Use current** or **Use incoming**. The choice applies to every conflict marker block in the file; it is not a per-component semantic merge.
4. Save a resolved copy, or explicitly confirm replacement of the conflicted file. A trusted workspace and unchanged saved source are required.
5. Optionally confirm **Stage resolved file**. Nothing is committed or pushed automatically.
6. Open the resolved design in KiCad and run native checks before accepting it.

See the illustrated [VS Code conflict guide](../vscode-extension/GUIDE.md#resolve-git-conflicts-visually).

## Troubleshooting and support

- **Missing subsheet/model:** import the complete project folder/ZIP and inspect path or size warnings. Absolute/external model paths may be unavailable.
- **Old drawing after an edit:** reimport browser snapshots, reload the loopback project, or close/reopen the VS Code editor.
- **Private repository fails:** check account access and the exact host/repository; a 404 may mean denied access. Android does not inherit a desktop browser's cookies.
- **Drafts missing on another device:** export/import their metadata. Local storage is separate for each app/browser profile, and loopback ports have separate browser storage.
- **Large project is incomplete:** inspect truncation and parser diagnostics; reduce the imported set rather than assuming a partial view is complete.

Contact [support.kivi@sigharmonic.com](mailto:support.kivi@sigharmonic.com) with the app/extension version, operating system, exact steps and a non-confidential minimal example. Do not include account tokens or private project data without authorization.


Review cards distinguish **Review: open / skipped / resolved / wont-fix** from
**Issue: open / closed**. A closed GitHub issue does not automatically resolve
its design annotations. Refresh the selected thread to read its current GitHub
state. Phone comments use the connected Android GitHub account; website login
alone does not connect the app.


### More room for drawings and tables

Use **Focus view** (fit-frame icon) to hide drawing sidebars and, in the local
browser workspace, its outer controls. **Restore controls** or Escape brings the
controls back without reopening the file. The file-list toggle remembers your
choice. In conflict review, **Properties** opens both field inspectors and
**View options** contains the secondary display controls. In the BoM manager,
**Filters**, **Columns** and **Totals** expand only when needed; opening one
advanced section closes the others so the table keeps its working space.

### Repository files and commit graph

Open **Repository** from the drawing tools or project page to browse files,
branches and commit history. Expand folders, search loaded paths, and open a
commit for its complete message, author, date and parent IDs. Graph colours
identify lanes; lines follow actual parents, including merges. Load older
commits to extend the graph. On phones, switch between **Files** and **Commit
history**; desktop views show both together.

Connected GitHub and GitLab projects expose repository metadata using the
client's existing authorization. Listings are bounded and show warnings when
truncated; expand folders to fetch additional contents. Browsing another
revision does not check out or modify files. VS Code uses its built-in Git
provider for history and working-file status colours. With native Git available,
select a commit and choose Browse files to inspect its saved tree. Opening a file
creates a separate read-only viewer pinned to that commit, including saved sheets
and model assets. It never replaces working files. Historical viewers do not write
workspace annotations or publish remotely. Open a nested repository directly when
its ancestor folder is the workspace. Restricted workspaces
and plain file imports show available files and explain unavailable history.


### 3D selection outlines

Selected parts use a clean edge outline with no triangle diagonals. Cross-selection
combines a component body, model meshes and matching pads into one component
boundary. Outlines respect scene depth so hidden edges do not show through the
board. Clearing selection removes the outline without changing model materials.

The default **Dim context** style now keeps selected parts, terminals or nets
coloured and greys the surrounding geometry in 2D and 3D. **Bright only** leaves
the context colours unchanged. Source geometry, model materials and visibility
settings are restored when highlights are cleared. A single cross-selected part
replaces the previous related selection; an explicit multi-selection is relayed
as a group. Selecting an individual reference in the BoM focuses that part.

The BoM manager shows colour-and-text assembly states, progress, mixed-state
counts and assembly/procurement grouping presets. Its checklist is local review
data, not a claim that physical assembly has been verified.

### Conversations and provider thread state

Open a conversation's **⋯** menu for **Close issue**, **Close discussion**, or
**Reopen**. Actions appear only when the connected provider reports permission.
Review the destination before confirming. GitHub issues and discussions, and
GitLab issues, are supported; GitLab discussion notes belong to their issue.
This changes the provider thread, separately from the local review-note state.
Drafts are retained. Administrator policies, workspace/source checks and Terms
acceptance still apply. Provider revision checks cannot make the subsequent
provider mutation atomic; stale and uncertain outcomes are reported.

### Project files and all-sheet review

The explorer's **Files** tab provides a searchable directory tree. The local
viewer and project preview retain their left file tree; narrow screens can hide
it with the file/menu control. Explicit hide/show preferences are preserved.

**All sheets** displays pages on one pan-and-zoom canvas with names above them.
Pages are organized as a hierarchy tree, with parents above their children and
branches spaced apart. Reused sheets retain their stacked instance identities;
unresolved ancestry remains visible without inventing parent relationships.

The compact **Sheet tree** box at the bottom of the schematic viewer provides an
interactive overview. Click a node to focus that page in All sheets, or navigate
to it from a single-sheet view. Blue marks the current sheet; gold marks sheets
containing the highlighted net. Scroll over the graph or use its **+ / −** buttons
to zoom, drag the graph to pan, and use **Fit** to restore the overview. Drag the
header to move the box within the drawing pane. Maximize it for a larger hierarchy,
minimize it with the header **−**, or close it with **×**. Reopen it through the
spanner **More tools → Setup → Show sheet tree**.

Entering a sheet clears object and sheet-group selections. A highlighted net stays
highlighted when it has a matching connection in the destination sheet; otherwise
nothing is selected. The **Theme** button switches the interface and drawing in
all open panes. **T** switches only the drawing theme.
Select a part or net, or double-click a sheet to enter it. Reused files retain
their placement stack. **Hierarchy links** and **Net links** can be toggled
independently. Relationship paths use the page gutters rather than running
through drawing content; dense graphs can still share routes or cross. Only
resolved saved relationships are shown, with bounded routing and omission notes
in **Guide**. The Fit view adapts to rotation until you pan or zoom manually.

Linked saved-simulation popups also work in 3D and follow their projected saved
net anchor without resetting the sample cursor. Comment anchors project into
3D from their saved PCB object or position (up to 64 pins). Projection checks
the camera frustum; it is not an occlusion test. These are saved-data views and
do not run a solver.


### KiCad layer colours

PCB objects and layer swatches use the KiCad Default palette: front copper red,
back copper blue, distinct inner copper layers, and matching silkscreen, mask,
paste, fabrication, courtyard, outline and user-layer colours. Solder mask and
paste retain their default colour alpha. The same palette supplies recognized
Gerber layer roles and the 3D copper preview; model-provided material colours and
intentional review/net-class overrides are retained. This is the built-in default
palette, not an import of a user-customized KiCad colour theme.

Palette reference: [KiCad built-in colour themes](https://docs.kicad.org/doxygen/builtin__color__themes_8h_source.html).

### Object visibility

In a PCB drawing, open **View options → Objects**. Toggle individual types or
**All objects**, and choose **Both**, **Top** or **Bottom**. Choices are saved
locally and shared between the 2D and 3D views. **Reset objects** restores every
type and both sides; layer visibility and saved copper-fill/outline controls
remain independent. Hidden geometry is excluded from picking. Filtering does
not move the camera or edit the project.

| Filter | Saved geometry |
| --- | --- |
| Arcs, Pads, Vias, Tracks | Their corresponding PCB geometry, including pad/via drill cutouts |
| Texts | Visible drawing text and generated close-zoom net/pad labels in 2D; source-hidden fields stay hidden |
| Fills | Saved filled copper zones and filled graphic rectangles/circles in 2D; saved filled copper in 3D |
| Polygons | Zone boundaries and unfilled graphic polygons in 2D; unfilled zone boundaries in 3D |
| Regions | Filled graphic polygons in 2D |
| Graphics | Other saved graphic lines, circles and unfilled rectangles in 2D |
| 3D bodies | Linked component models and identified stand-ins in 3D |

Dimmed rows are unavailable in the current view. Dimensions are not currently
rendered, and Rooms are not a KiCad object type. In 3D, text, graphic and region
rows remain unavailable rather than pretending to show unsupported geometry.
Through vias and common board geometry remain available on either side;
front/back object filters compose with the separate layer controls.


### Stop a load

Select **Stop** on a loading surface to cancel that read or import. Preparation
workers terminate, pending read results are discarded, and stopped initial
drawings offer **Retry loading**. Opening another file cancels the previous
preparation. The existing project and sign-in are retained. Publishing, uploads
and saved-library writes do not show Stop because a remote write cannot be
rolled back by cancelling the screen. Shared snapshot downloads continue when
another view still needs them. VS Code can stop preparation and stop waiting for
a source read; its public filesystem API cannot abort an already issued host read.
Elapsed time uses hours and minutes for long jobs. Initial drawing waits are
bounded; use a smaller project or retry if the timeout message appears.


### Read and reply to issue conversations

In Chrome, Android or a trusted VS Code Git checkout, open **Review → Comments →
View comments**. Choose Issue (or a GitHub Discussion), enter its number and select
**Load thread**. The reader shows the issue body, ordinary comments, grouped replies,
authors, dates and remote open/closed state. GitLab Discussions belong to an issue;
the reader uses that issue's number. Bounded loading reports omitted/truncated data.

Use **Reply** to prepare an anchored draft, review its existing-thread destination
and explicitly publish. A local review state such as skipped/resolved is separate
from the provider's open/closed issue state. The viewer does not provide a complete
notification inbox or live synchronization.

For VS Code, use the account/settings control in Comments. GitHub uses VS Code's
native account consent; GitLab uses an exact-host token prompt backed by
SecretStorage. The workspace must be trusted and have a supported, unambiguous
Git remote. Thread reading can work on a changed drawing; publishing and pinned
annotation readback require its displayed sources to match raw committed Git
objects. Commit changes and reopen if the source-verification check rejects them.

### Browser project dashboard

Open the extension directly away from a supported repository page, or choose
**Projects** from viewer tools / **Project dashboard** in Settings. Recent remote
projects reopen their saved revision; local entries say **Reselect files** because
the history does not cache imported sources. Search/filter by source, remove an
entry, or explicitly clear the local history. Only projects opened after this
update are recorded. Contextual toolbar actions on GitHub/GitLab remain available.

## Generate drawing downloads in the browser

Choose **Download drawing or BoM** in the drawing tools. Generate **PDF** or **PNG**
from the full current schematic sheet/PCB layout, or just the current 2D viewport.
The repository does not need to contain a PDF. The export uses the saved drawing's
current layers and object visibility, without review panels or selection overlays.
Each download covers one current sheet or layout, not the entire sheet hierarchy.

PDFs contain raster viewer drawings, bounded to 4096 pixels per edge and 12
megapixels; they are not native KiCad vector plots. PDF/image saving currently
requires the browser viewer. **BoM CSV…** opens the BoM manager, where columns,
filters and grouping can be reviewed before **Import / export → Export visible CSV**.
BoM text export also supports the app's existing save dialog.

### Saved graphic styles

The unreleased candidate preserves saved schematic stroke, fill and text RGBA colours, outline/background/colour fills, hatching and dash styles. Explicit colours are independent of the drawing theme. Without a saved colour, light schematics use KiCad's standard colour roles; dark mode supplies contrasting defaults. PCB graphics use their layer colours and saved solid/outline fill and stroke styles. Symbol background fills use the body-background colour rather than the page colour.

Hatch previews use a bounded repeating pattern with 4 mm spacing and 40% opacity measured in the KiCad 10.0.6 reference export; very small screen spacing is clamped for readability. Imported native theme settings and pixel-identical hatch/font rendering are not claimed. Selection highlighting can temporarily override source colours.

### 3D exploded view

Use the **Explode** slider on the 3D ribbon to separate saved copper layers. Component models follow their board side, via walls span their endpoint layers, and selection highlights and open 3D probes follow the separation. Return the slider to **0%** to restore the assembly. This is visual spacing: the substrate stays centered and saved board coordinates remain unchanged. This control is part of the unreleased candidate.

### 3D lighting

Open **3D → Display → Lighting** and choose **Universal** for neutral, even illumination from above, below and the board edges. It disables cast shadows and ambient occlusion while preserving source materials, reflections and selection colours. **Studio** restores directional lighting and quality-dependent shadows/occlusion. The preference is remembered on the current device and is independent of the light/dark theme and rendering quality. Both modes use a bounded reusable light rig with no additional network assets. This shared control is included in subsequent browser, VS Code and Android builds; previously published binaries are unchanged.

### Saved ERC and DRC annotations

Open **More tools → Rules** in the web/VS Code viewer, or **Drawing tools → Rules** on Android (ERC for schematics, DRC for boards). Under **Load saved KiCad report**, import an official KiCad JSON report or load its path from the repository. Findings show severity-coloured markers at saved positions, an aligned arrow to the selected affected item and a compact on-canvas note. The note includes the description, affected item and any exclusion comment. Use **Show selected finding note** or its close button to reduce clutter; **Details** reopens the floating findings panel. On phones the panel closes when jumping to a finding so the drawing remains visible. Previous/Next finding and item controls retain the selected annotation even for reports with many affected items.

Associate ERC subsheets explicitly when their UUID cannot resolve uniquely; sheet display names are not assumed to be filenames. Coordinates are converted from the report's declared mm, mils or inch units. Locations without a resolved drawing/position are listed without invented markers. Reports remain unverified saved evidence and can be stale. This imports JSON results; it does not execute ERC/DRC or ingest arbitrary plain-text reports.


### Drawing and 3D keyboard shortcuts

Use **H**, **backtick** or **~** to highlight the net under the pointer (or the selected net in 3D). In PCB views, **F** flips the board; **Shift+F** fits the drawing or focused layer. The Fit button remains available. In schematics, **F** mirrors the view. **R** rotates the main or focused pop-up view 15° clockwise; **Shift+R** rotates 15° counterclockwise. The rotation buttons use the same increment.

In 3D, **X**, **Y** and **Z** select the positive axis views (right, back and top). **Shift+X**, **Shift+Y** and **Shift+Z** select the opposite views (left, front and bottom). **F** moves to the opposite side while preserving the orbit target and distance; **Shift+F** fits the isometric view and **Home** fits the top view. Axis-view shortcuts also work in focused 3D pop-ups. These shortcuts are inactive in text fields, editable content and input-method composition, and do not change saved board geometry. Pop-up guide lines continue inside the viewport to the selected geometry or picked point, tracking pan, zoom, rotation and flip; off-screen targets are not given a false endpoint. Selecting a new part, pin or net inside a pop-up updates its identity, highlight and guide endpoint. Press **P** or choose **Open probe** to open another independent sibling pop-up from that selection; guides connect the source and destination pop-ups, and closing one does not close the others. Unnamed schematic networks can cross-probe through saved component pin/pad associations; ambiguous or conflicting associations show an error instead of a guessed connection.


### Draftsman documentation

Open **Draftsman** in the drawing toolbar for customizable multi-sheet documentation, automatic outline dimensions, snapped manual dimensions, notes and a BoM. Export PDF/SVG or an editable document, save to a selected folder, or confirm a new GitHub/GitLab documentation branch. [Draftsman workflow, source provenance and export limits](DRAFTSMAN.md).
