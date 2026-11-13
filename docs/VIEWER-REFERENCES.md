# Viewer and companion-app references

User direction, recorded 2026-10-10: use Siemens Xpedition and Altium as feature and workflow references for KiCad Online and the shared browser/VS Code viewer. This is a design direction, not a claim of feature parity or support for their native file formats.

## Verified reference capabilities

- [Altium 365 Web Viewer](https://www.altium.com/documentation/altium-365/viewers/web-viewer?version=4): linked schematic, PCB, 3D and BOM inspection; component/net cross-probing; searchable object information; contextual comments and tasks; layer inspection; access-controlled links to a particular view. Documentation checked 2026-10-10.
- [Siemens Xpedition Viewer](https://intercom.help/sw-siemens-eda/en/articles/11421232-what-is-the-xpedition-viewer-application): project and ancillary-file organization, measurements, design markup, multiple-document viewing, cross-probing, graphical and connectivity/version comparisons, and controlled guest review. Several collaboration features are Standard-tier capabilities. Documentation checked 2026-10-10.

## KiCad Prism interaction reference

[KiCad Prism’s viewing guide](https://krishna-swaroop.github.io/KiCAD-Prism/use/viewing-designs/)
was checked on 12 November 2026. Its compact named-net highlight bar, contextual
selection panel, independent insets and sheet navigation inform the development
viewer’s presentation. These interactions are implemented independently; no Prism
code or screenshot assets are included. KiCad Online retains its own click
semantics, browser-session access model and sibling-popup lifecycle. This is an
interaction reference, not a claim of product parity or affiliation.

The official [KiCad Monkey](https://github.com/wavenumber-eng/kicad_monkey)
project and [Altium Monkey schema contract](https://github.com/wavenumber-eng/altium_monkey/blob/main/docs/schemas/altium_monkey/SPEC.md)
also inform source-bound sheet-instance and connection identity. Their data
contracts distinguish hierarchy from electrical connectivity and retain exact
terminal/connection identities. This informs endpoint correctness; it is not
proof of browser animation performance or a claim that their UI was reproduced.

## Apply to KiCad Online

| Workflow | Product direction | Acceptance evidence |
| --- | --- | --- |
| Find and inspect | One search entry for references, values, nets and sheets; brief properties first, details on expansion. | A search result selects the actual saved object and exposes its source sheet and properties. |
| Follow connectivity | Preserve selection between schematic, layout, 3D and BOM; show related sheets and connected parts. | Selecting in either direction preserves revision and object identity; unsupported connections are disclosed. |
| Navigate documents | Compact Project / Schematic / Layout navigation; split and compare alongside; 3D within Layout. | Switching views retains selection without duplicating toolbars; all-sheet navigation uses one canvas. |
| Review changes | Compare geometry, fields, connectivity and net names; keep field differences readable in properties. | Known add/remove/value/move fixtures identify both source revisions and do not expose hidden fields on the drawing. |
| Discuss a design | Point, object and area anchors; message/thread first; small context metadata; mentions and clear issue state. | An existing thread opens at its anchor; reply and edit remain usable with the phone keyboard visible. |
| Manage projects | Recent and starred projects, explicit online/offline availability, revision and download status; global account/library actions separate from active-project tools. | Reopening a downloaded project works offline; online links retain provider access checks. |
| Share review context | Consider links containing project, revision, sheet, selection and camera context. | Opening a link restores context only for an authorized project; no credentials enter URLs. This is a future candidate, not an implemented claim. |

## Phone and tablet adaptation

These are workflow references; Android uses its own touch interface. Keep controls compact with usable touch targets, large recognizable icons with small labels, two-stage draggable panels, deliberate long-press menus, net/part ambiguity choices, and keyboard-aware comment editing. Tablet layouts can expose more context while retaining the same selection and navigation model.

Prioritize coherent selection/search, readable contextual inspection and commenting, and dependable project access before adding more persistent controls. Evaluate each feature in a real phone viewport and a tablet viewport. Retain KiCad saved-data fidelity, GitHub/GitLab integration, offline copies, and the user's >80% visible drawing-area goal where feasible; reference products do not override those requirements.

Native Altium/Xpedition import, their cloud services, and full editing or solver execution require separate implementation and verification. Do not infer Android companion-app availability from browser-viewer documentation.
