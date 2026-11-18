# Native simulation reference

The unchanged two-tab workbook comes from KiCad 10.0.6, `demos/simulation/generic_models/generic_opamp_bip.wbk`. Credit: the KiCad project and the demonstration's authors. KiCad's distribution COPYRIGHT.txt licenses demos/* under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); this design data is not licensed as the viewer's MPL software. Upstream source: https://gitlab.com/kicad/code/kicad/-/tree/10.0.6/demos/simulation/generic_models .

The transient and AC ASCII RAW files are fresh ngspice-46 outputs, produced from the installed KiCad schematic's SPICE netlist and original analysis commands. The browser views saved results and does not run a solver. `PROVENANCE.json` identifies hashes and numerical references. No graphical KiCad simulator run is claimed.

The two native tabs bind explicitly to their saved outputs using project.json. Additional nested-DC and isolated KERO timing-branch datasets exercise repeated sweep values and AC readouts. The KERO branch includes only its actual 1 MΩ / 1 µF passive branch and an explicitly added ideal test source; it is not a full KERO simulation. KERO as saved has unassigned SPICE device models. Public KERO source revision: 7be8fef589bc28eee149323e3790ef95b0873032.

Native checks compared six runs against 19 reference values. The amplifier's 100 kΩ/10 kΩ ratio predicts about 20 dB at low frequency; its 1 V AC stimulus makes output dBV numerically equal to transfer gain. The isolated RC corner predicts −3.010300 dBV and −45° at 0.1591549431 Hz. Values and tolerances are retained in results.json; paired cursor references are in cursor-reference.json. No missing samples were introduced into the native files. Gap handling uses separate regression cases.

Reproduction requires the matching KiCad demo schematic/project, installed Simulation_SPICE.sp and KiCad's ngspice library. Export the native SPICE netlist, run the .tran/.ac commands saved in the workbook, select the saved waveform vectors and write ASCII RAW. No private project or external proprietary model is required.

## Cursor regression workbooks

These two workbook files are unchanged copies from the KiCad 10.0.6 Windows distribution. KiCad licenses the demonstrations under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

- `smps-com.wbk` comes from the KiCad project's boost converter demonstration. It records two voltage cursors on the output trace. [KiCad boost converter source](https://gitlab.com/kicad/code/kicad/-/blob/10.0.6/demos/simulation/power_supplies/boost/smps-com.wbk)
- `Class-D.wbk` comes from the KiCad project's Class-D audio amplifier demonstration. The schematic title block credits Holger Vogt. The workbook records one power cursor and difference formatting. [KiCad Class-D source](https://gitlab.com/kicad/code/kicad/-/blob/10.0.6/demos/simulation/class-d/Class-D.wbk)

The cursor regression tests supply small synthetic waveform tables with known gaps in the time grid to check editing and export. `PROVENANCE.json` records the original filenames and SHA-256 hashes.
