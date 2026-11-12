# Experimental Fast DC drop

Fast DC drop is a browser-local, fixed-temperature 2.5D DC copper screening workflow.
1. In **Layout** or **3D**, click **Fast DC drop** on the drawing toolbar (also available under Simulation). Setup and results stay on the active board canvas.
2. Click **A** on source copper. The viewer detects the saved net and copper layer.
3. Click **B** on the same net for the load. A different-net click is rejected while A stays selected. Overlapping copper asks which net/layer you intended.
4. Enter the starting voltage and load **Current · A** or **Power · W**, then **Run**.

The viewer reuses the saved physical stackup and chooses an initial mesh from
the selected copper. Nearby supported pads/tracks can snap to their copper;
the marked A/B positions show the contacts actually used. **Contact options**
provides saved-pad suggestions, manual net/layer selection and individual contact
changes. Inputs and contacts remain after a failed run.

While picking, use **Pause picking** to pan or zoom the board, then **Resume B**
to continue without losing A. **Choose pads** stays available during picking and
offers a source-net selector plus searchable saved pads. **Change A** and
**Change B** replace one contact; changing A to another net requires a new B.
Escape pauses picking, and Close hides the panel while retaining its inputs,
contacts and accepted result for the same unchanged board. **Clear contacts /
result** is the explicit reset.

Switch between Layout and 3D without losing the contacts or accepted result. In 3D, complete solved copper cells are displayed at their saved layer elevations and follow the explode slider; partial boundary cells are omitted. Use Layout for the boundary-clipped field.

In results, switch the copper layer or overlay metric without rerunning.
**Edit inputs** lets you inspect the setup; **Back to results** returns to the
accepted result if nothing changed. Committed input/contact changes invalidate
it. Invalid fields are revealed and focused so you can correct them without
re-entering A and B.

The worker solves the saved filled copper, straight tracks, supported pads and
lumped plated via/through-hole barrel transitions. It never refills zones or
modifies the design. Supply layer center elevations and copper thicknesses in mm;
via plating thickness is required for barrel transitions. Copper
conductivity starts with a visible nominal copper preset of 58 MS/m and the
via-wall preset is 0.025 mm (25 µm). These are screening assumptions, not
measurements from the board; change them in **Advanced** for your fabrication,
material and temperature. Complete saved physical
stackups are prefilled; incomplete stackups require explicit layer dimensions. Dielectric
separation contributes to barrel length via layer elevations, not DC lateral
conductivity. There is no invented stackup fallback.

The sidebar reports terminal voltage relative to the supplied ideal source,
voltage drop, current, resistance, total copper loss and peak mesh-edge current
density. Display a voltage-drop gradient or current magnitude, with signed current
arrows, on the existing PCB view. The overlay is sampled on large meshes. Isolate
the analyzed net through the canonical net mapping. Float the results panel when
needed. Cancel/clear terminates the worker; solves have a 30-second UI timeout.

Contact-resolution failures trigger at most two finer-mesh retries within the
existing work limits and 30-second timeout. The result reports the actual mesh
size and any refinement. Disconnected copper and invalid physical inputs still
fail; automatic refinement is not a convergence/accuracy study.

## Scope and evidence

This is experimental screening, not a replacement for Quick PI or SPIKE.
The source is an ideal voltage contact. In current mode the load is a point
current sink. In power mode it is a point constant-power sink: one reference
DC solve supplies the copper resistance and field, then the high-voltage
operating point is calculated from `Vload = Vs − I·R` and `P = Vload·I`.
The reported current therefore includes copper drop rather than using `P/Vs`.
Loads at or too close to the voltage-collapse limit are rejected. This does
not model a regulator's dynamics or establish transient stability.
Return-network impedance, AC effects, temperature feedback, device models and
physical qualification are outside this model. Copper islands disconnected from
the source retain unknown voltage. Unsupported arc tracks, custom pads and slotted
or offset drills are rejected. Cell-center meshing can miss narrow traces, gaps,
thermal spokes and pad spreading; inspect the geometry and repeat at finer mesh
resolutions before relying on a result, especially peak current density. A contact
is mapped to a nearby cell and displayed at the picked location.

Analytical tests cover rho*L/A resistance, via barrel resistance, voltage reference
offsets, disconnected copper, rotated pads, through-hole transitions, resolution
checks, Kirchhoff current balance and power conservation. These are software and
analytical checks, not measurement correlation on a manufactured board.

Saved wayriCAD spatial results and KiCad simulation workbooks/waveforms remain
separate import workflows. Fast DC drop does not run ngspice or pretend that workbook
settings alone contain solved samples. Hosts that prohibit dedicated workers show
an unavailable diagnostic rather than blocking the UI with a synchronous solve.
