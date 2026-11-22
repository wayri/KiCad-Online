# Saved analysis and simulation results

In KiCad Online, open **Project → Analysis & simulation**, then choose a saved report. Reports imported with a project are retained in its offline copy. Standalone supported report files can also open directly. In the browser extension, choose **Analysis** in the project viewer. Use KiCad, ngspice or the producing WayriCAD tool to run analyses and export numerical results. The viewer reads saved settings and samples and treats saved analysis commands as text.

The viewer has Graphs, Data, Report and Source views. Select traces and linear/logarithmic axes for waveforms; point at a graph to read values. Thermal maps retain missing cells as gaps. Mechanical meshes can be rotated by dragging. Search Report for source hashes, assumptions, warnings, coverage and findings. Large property lists and tables load in batches.

## Separate simulation sources

The saved-report picker separates **KiCad / SPICE simulation**, **wayriCAD analysis**,
and **Other / unclassified exports**. KiCad `.wbk` settings and ASCII `.raw` samples
remain separate from wayriCAD PI, SI, thermal and mechanical reports. Generic CSV/JSON
files remain unclassified unless a recognised producer contract or file path identifies
their family; open these explicitly from Other or All. A family label is a browsing
hint, not proof of origin or a match to the current design.

wayriCAD entries offer **2D + probe** and **3D + probe** shortcuts. Saved spatial
fields use the existing overlay, layer/time controls and A/B point probes; exports
with only time/frequency samples remain graphs. Exact source-hash and coordinate
checks still govern attachment to a PCB. Missing spatial fields, mechanical scalar
values, or net identities are never inferred. Net waveform popups retain the source
family label in both schematic/layout and 3D views. Viewing and probing saved results
does not execute either KiCad or wayriCAD plugins or solvers.

## Open a KiCad simulation workbook

Follow the [workbook and drawing sheet walkthrough](SIMULATION-WALKTHROUGH.md) for the KiCad export steps and transient, AC, nested DC, and switching examples.

Include the `.wbk` and its ASCII SPICE `.raw`, CSV or TSV exports in the same project. Open the workbook, select a workbook tab, then choose its export from **Saved result**. Each tab has its own binding. Result files are read when selected from the same project revision. Use the export from the intended run. Opening an ASCII RAW file directly gives you its saved plots without a workbook.

In **Graphs**, choose visible signals and a cursor signal. Pan or zoom the plot, use **Fit** to reset the view, and set **Cursor A** and **Cursor B** to compare saved samples. You can step a cursor through saved samples with the arrow keys. AC plots provide magnitude, dB, phase, and real/imaginary views. For nested DC sweeps, select a sweep to compare samples at repeated x values. **Locate net** sends the exact saved voltage net name to the chosen drawing. Data, Report and Source describe the selected project file.

The workspace restores the first matching saved cursor A and B for display. A cursor outside the result range retains its saved x position and has no numerical y readout. **Save workbook** downloads a copy. Modern workbook export preserves untouched cursor records and unknown fields. The viewer reports settings that the workbook format cannot store and exports legacy workbooks as their original text. Keep the result exports alongside the workbook.

The workbook workspace accepts up to 64 files, one workbook per workspace, an 8 MiB workbook and 128 MiB of total input. Individual result files are limited to 64 MiB. Plot summaries preserve extrema and gaps within the drawing budget. Cursors read the retained samples.

## Inspect other saved results

On a graph, select **Probe signal** for a waveform, then tap to inspect a saved sample. Choose **Mark A**, tap the first point, then **Mark B** and tap the second. The viewer retains both readouts and shows B minus A. Waveforms report the saved axis and signal name; thermal and PI fields show X/Y in millimetres, distance and the change in the saved field unit. **Clear probes** starts again. Changing plots, files or probe signals clears prior probes so unrelated results cannot be compared accidentally.

Waveform probes use the nearest saved sample without interpolating through missing samples. Repeated event times remain separate saved data entries; a probe at an identical timestamp chooses the first entry. Thermal probes select the saved cell centre, using midpoint boundaries for nonuniform or reversed axes. PI nodal probes interpolate barycentrically within one saved triangle; cell-based fields use the saved cell value. Missing nodes/cells and mesh holes produce no numerical value. PI triangle colours still show the nodal mean, which can differ from the interpolated point readout. These tools inspect exported results and do not rerun the simulation.

Multilayer QuickTherm transient exports with `spatial_index` open as separate saved layer fields. Use **Saved time** to select an exported frame; pinned A/B locations remain in place and their values update. Pinned-point history plots show the saved temperatures over time; tap the history to select the nearest saved frame. Only saved active cells are filled. Frames without spatial indexing remain searchable numerical data; the viewer does not guess their placement. PI electrothermal thermal-node traces and coupled-air board/component temperature and power histories also plot against saved seconds.

Spatial fields offer **2D overlay**, **3D overlay** and the original map, with opacity and Fit controls. The 2D overlay supports pan/zoom and probing in saved millimetre coordinates. The 3D view supports orbit, pan, zoom, Top view and numerical surface probes. Missing cells remain holes. Saved layer elevations are used when available; otherwise standalone surfaces are planar and their missing elevation is identified. Surface rendering is limited to 200,000 triangles.

An imported PCB is attached only when its exact SHA-256 matches the producer's saved source binding. A verified board can display its available 3D models behind the result overlay. Placement also requires a known elevation convention or explicit front/back copper layer; other fields use a standalone saved surface. The selected field is shown through opaque board geometry so internal layers remain inspectable. Without a matching source, the viewer shows saved result geometry alone. SI eye and waveform exports remain plots unless they include supported spatial data.

For a PCB layout in KiCad Online, tap **Measure** in the drawing toolbar. Tap two points for distance, or select **Angle** in **Measurement options** and tap endpoint → vertex → endpoint. The live and pinned readout stays visible above the drawing. Options include geometry and grid snapping, grid pitch, board extents and millimetres/mils. **Exit** or Android Back leaves measurement mode. Measurements use the saved layout geometry.

## Verified formats

| Saved output | Presentation |
| --- | --- |
| Quick PI mesh/result JSON bundle | Nodal-potential, cell-power and current-density-magnitude fields, separated by saved copper layer when available. Triangle potential colours use the mean of saved node values; unknown values remain gaps. |
| Quick PI transient | Saved source and load voltage/current waveforms against `times_s`; repeated event timestamps retained. |
| QuickTherm full JSON | Physical thin-sheet board-temperature field and separately labelled illustrative junction interpolation, component tables and transient temperatures/power. |
| Quick SI | Illustrative eye traces, saved step response, separate reference-covered impedance and ideal-plane screening curves and report metadata. |
| Trace RLC and planar magnetics | Saved frequency sweeps, impedance/current results, and exported CSV dynamics. |
| Mechanical Check | Saved triangle-mesh scene, finding tables, measured limits and coverage. Scene coordinates are retained; they are not assumed to be PCB coordinates. |
| Other WayriCAD tools | Generic saved JSON fields/record tables and CSV/TSV tables, including manufacturing checks, heater summaries and BOM-style exports. A specialised plot requires saved numerical data; the viewer does not invent missing fields or grids. |
| KiCad `.wbk` | JSON workbooks (versions 6–8 and retained unknown fields), plus legacy line-oriented versions 1–5: commands, signals, cursors and display settings. No fabricated waveforms. |
| KiCad plot CSV / TSV | Numeric columns plotted against the first numeric column. Semicolon export and trailing empty column supported; saved display names retained. |
| ngspice ASCII `.raw` | Real and complex samples, with workbook-defined gain and phase or selectable complex views. Export binary RAW to ASCII RAW or KiCad CSV before opening it here. |
| HTML / text reports | Inert report text and HTML tables. Scripts, external assets and interactive embedded HTML plots are not executed; open the companion JSON/CSV for plots. |

The saved-result viewer bounds each source at 64 MiB, tabular data at 200,000 rows / four million cells, and SPICE data at four million values. Eye plots display all saved contexts up to 512 traces. Source preview is limited to 512,000 characters; report-property inspection is limited to 4,000 fields. Native import/download and repository discovery retain their separate project budgets. Unsupported schemas remain searchable as saved JSON rather than being treated as new analysis results.

Current source opens saved reports in a dedicated VS Code panel rather than a nested frame. The selected voltage trace can locate its exact net in the original drawing session. No CSP permissions were expanded for this feature. See [saved waveform linking](REVISION-REVIEW.md#link-saved-samples-to-a-net) for matching requirements and limits.

## Format evidence

KiCad 10.0.6 supplied the original op-amp workbook and the SPICE netlist for transient, AC and nested DC sample checks using its bundled ngspice-46 shared library. The KERO reference covers only the isolated R1/C3 timing branch with an ideal test source. The saved KERO circuit lacks models for a full native simulation. The fixture record includes numerical references, cursor comparisons, and source and result hashes. [Native simulation fixtures](../extension/tests/fixtures/simulation/native/README.md)

Adapters were checked against WayriCAD develop commit `1b0590d016266a3c98264a1dda0a2f02abc2a5ac`, including the public QuickTherm example. Synthetic tests reproduce the documented PI, SI, mechanical and transient contracts; they do not establish numerical solver accuracy.

Additional compatibility checks use [11 actual producer fixtures](../extension/tests/fixtures/wayricad/README.md) from the local WayriCAD/kiWay implementations, with retained source commits, producer hashes and fixture hashes. Their inputs are analytical test cases. The tests verify saved numeric arrays, PI field units, thermal histories and layer-major spatial frame mapping, rather than qualifying those solvers.

- [WayriCAD source and tool documentation](https://github.com/wayri/WayriCAD/tree/1b0590d016266a3c98264a1dda0a2f02abc2a5ac)
- [QuickTherm saved example](https://github.com/wayri/WayriCAD/blob/1b0590d016266a3c98264a1dda0a2f02abc2a5ac/quick_therm_plugin/examples/thermal-demo-report.json)
- [KiCad workbook documentation](https://docs.kicad.org/9.0/en/eeschema/eeschema.html#saving-simulation-setups)
- [KiCad 10 workbook serializer](https://github.com/KiCad/kicad-source-mirror/blob/10.0/eeschema/sim/simulator_frame_ui.cpp)
- [KiCad legacy workbook loader](https://docs.kicad.org/doxygen/legacy__workbook_8cpp_source.html)
- [ngspice raw-file reader/writer](https://github.com/ngspice/ngspice/blob/master/src/frontend/rawfile.c)
