# Compare designs and BoMs

This guide describes development source for the **unreleased 0.12.91 candidate**. Existing prepared package snapshots have not yet been refreshed with the History tab. Published store versions may differ.

Open **Engineering tools → Compare designs / CSV BoMs**, **Compare BoMs** in the BoM viewer, or **Unified compare** in a repository drawing review.

1. Import the base and head files, or import both project folders. Folder imports preserve paths, subsheets and included model files.
2. Choose **Compare**. The list reports added, removed and modified objects; use the search and domain/status filters to narrow it.
3. Select a delta, then choose **BoM**, **Text**, **Properties**, **Schematic**, **Layout** or **3D**. Select another file to inspect its domain.
4. Use **Highlight differences** and **Fit both** for the drawing panes. Each pane retains its own navigation.
5. Choose **Export deltas** to download the comparison report. Source files remain unchanged.

CSV BoMs are matched by expanded component references, so reordered rows and grouped references do not create false changes. Value, footprint, custom fields and population changes appear as before/after values. Ambiguous or duplicate references are rejected.

For repository revisions, open this tool from the authorized repository viewer, enter the base and head references and choose a saved drawing or source file. Reads use the existing browser-session transport. Organization SSO and website policies continue to apply.

## What a delta means

Schematic and PCB identities are scoped to their source file. Property, position and rotation changes are reported from saved objects. The 3D tab uses the production PCB viewer to highlight those objects; model-reference and saved transform changes are listed. It does **not** compute Boolean differences between component meshes. Missing model files retain the viewer's normal diagnostics. Repository comparison currently imports drawing sources without STEP/WRL assets; import complete local folders to include model geometry.

Imports accept up to 128 files and 96 MiB per revision. Drawing highlighting shows at most 200 changed objects per file. Text comparisons use bounded work and disclose fallback or rendering limits. A change count describes the saved objects supported by the parser, not an electrical-equivalence check or a pixel-perfect visual diff.

## Repository branches and history

Choose the **History** tab in the top bar, beside Schematic, Layout and 3D, to see the full commit timeline. Switching back retains the open drawing and its view. Search by message, author, branch or SHA; nonmatching cards remain dimmed so connections stay readable. Choose **Set base** and **Set head**, then **Compare selected**. **Swap** reverses the comparison direction. **View commit** opens a saved revision, while **Compare with current** uses the displayed pinned revision.

The branch selector resolves a selected branch through the existing repository session before loading its history. Branch badges appear only when a tip SHA is verified. Commit cards show saved messages and metadata; they do not invent component counts, release events or design-analysis results.

Open **Repository** to browse files alongside the repository graph. Graph lines follow verified parent IDs; missing ancestry is labelled unknown. Browser-session discovery reads a bounded website window: up to 20 branch entries and the initial 30 commits. Partial listings are identified explicitly. No branch tip or parent is inferred from ordering.

## Fresh comparison examples

These captures use retained public demo files with **controlled, labelled edits**, rather than claiming two upstream releases differ. The PIC Programmer example changes C1's value; the HP34401a BoM example changes R1 from 100k to 110k. The board remains the original public design. Demo authors and sources are listed in [acknowledgements](DEMO-BOARD-CREDITS.md).

![CSV BoM field delta](images/comparison-0.12.91/bom.jpg)

![Hierarchical schematic comparison](images/comparison-0.12.91/schematic.jpg)

![PCB layout comparison](images/comparison-0.12.91/layout.jpg)

![3D comparison of the saved board](images/comparison-0.12.91/3d.jpg)

![Text comparison](images/comparison-0.12.91/text.jpg)

The History capture below is a **replay of real public Git objects**, shown through the production top-bar History tab. It includes the two verified parents of merge `8c98e6e` in `wayri/KiCad-Online`. This is a UI acceptance check, not an installed-extension transport test or proof of historical design contents.

![Dedicated History tab with a real recorded merge and selected revisions](images/history-0.12.91/history-desktop.jpg)

[Mobile layout](images/history-0.12.91/history-mobile.jpg) · [Light theme](images/history-0.12.91/history-light.jpg) · [Capture provenance](images/history-0.12.91/capture-manifest.json)
