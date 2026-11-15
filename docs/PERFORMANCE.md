# Viewer performance checks

## Local snapshot reuse (development, November 2026)

Disk-backed local transports coalesce repeated reads within one imported
snapshot. Successful decoded text is retained in an LRU cache with a 32 MiB
estimated text budget and 64-entry limit. Oversized or underestimated results
are not retained; failed reads can be retried. Scope and expiry are checked on
warm reads too. These limits cover retained entries, not all concurrent requests
or results held by callers. Android reuses the adapter for the exact snapshot
object, keeping revisions and separate imports isolated.

Opening the same Android drawing again, including after returning Home, now
preserves its existing workspace instead of navigating its iframe again.
Changing the file, project or pinned revision still opens a new workspace.

Reproduce the local-read benchmark with an existing PCB of at most 8 MiB:

```text
node extension/tests/benchmark-local-read-cache.cjs path/to/board.kicad_pcb
```

On the development Windows host, a retained 2,131,833-byte public PCB took a
median 157.32 ms before reuse and 9.14 ms after reuse for 20 sequential reads
(three rounds). Disk reads fell from 20 to one per snapshot. The benchmark
compares the checked-out code against HEAD and measures local reading and
UTF-8 decoding. It does not measure network transfers, rendering, phone frame
rates or end-to-end project opening. Physical-device acceptance of this update
is pending.

The Android 1.41 and shared browser viewer changes address repeated parsing
and offscreen text painting. Drawing preparation now validates and parses each
source once per job, reusing the AST and collected objects for the design model,
initial geometry and connectivity. Opaque snapshots reject changed sources and
are held in a WeakMap so completed jobs do not retain a global project cache.
Record IDs remain independent between consumers.

Canvas labels use actual glyph metrics for conservative viewport culling.
Metrics are cached during panning and recomputed on zoom or board flip.
Rotation, multiline labels, alignment, baseline, width and minimum font size
are included. Missing metrics preserve the prior always-visible behavior.
Initial drawing and zoom still require calculating label bounds.

## Reproducible CPU benchmarks

Run from the repository root:

```text
node extension/tests/drawing-preparation.bench.cjs
node extension/tests/benchmark-canvas-labels.cjs
```

Measured on the development Windows host on 2026-10-10:

| Workload | Previous path | Optimized path |
| --- | ---: | ---: |
| Synthetic 12,000-track PCB, 1.1 MB; median of five preparations | 270.81 ms | 139.43 ms |
| Synthetic 40,000 labels, zoomed 40 x 30 mm; median of 20 warm pans | 47.45 ms | 4.63 ms |
| Text paint calls per warm pan in the second workload | 40,000 | 75.95 |

Both preparation paths produce 12,000 objects, 12,054 primitives and one net.
These timings isolate CPU work; the label benchmark uses a no-op Canvas and
excludes browser rasterization. They do not establish Android frame rates,
network download performance, or end-to-end loading time for every project.

Validation: 839 shared viewer, web and Android JavaScript checks; three Android
packaging checks; Android debug build and lint. Focused tests compare prepared
and ordinary geometry/connectivity, source immutability, invalid snapshots,
and offscreen text behavior. Android 1.41 (code 44) was installed in place on
the connected device, preserving app data.

## Local download reuse (Android 1.42)

Online project opening checks downloaded manifests before making network requests.
Copies match provider, host, repository and requested branch or pinned commit.
Temporary expiry, deletion markers, stored paths and file sizes are checked.
Missing or incomplete copies fall back to downloading. Reopening preserves the
original expiry and cached revision; it does not refresh a branch automatically.
GitHub and GitLab device acceptance tests cover reuse, provider/host/revision
isolation, incomplete files, expiry and fallback to a permanent copy.


## Drawing interaction and parser optimization (development, October 2026)

Large-board population overlays now cache their per-file part lists by model,
variant and object-array identity. Panning no longer allocates an index of every
saved object or scans all copper objects on each frame. Selected-part geometry
bounds are reused until the geometry array or selected UUID changes.

Status text and copper controls update only when their values change. Android
menu discovery, shared sidebar discovery and presentation discovery ignore text
replacement and SVG overlay mutations; newly added HTML controls are still
prepared. Section navigation observes relevant page visibility changes. Active
presentation sheet names continue to refresh.

The S-expression tokenizer uses character codes for ASCII whitespace and
separators, retaining the original Unicode whitespace, escaping, comment,
numeric validation, nesting and size-limit behavior.

Measured on Windows, Node v24.14.0, using the 44,059,775-byte Marble PCB
(83,513 saved objects), five runs per case, median:

| CPU stage | Before | After |
| --- | ---: | ---: |
| Parse source | 1,018.84 ms | 420.32 ms |
| Warm population-overlay lookup per frame | 18.86 ms | less than 0.01 ms |

These are CPU-stage measurements, not total Android opening times or frame
rates. They exclude network transfers, worker result cloning and canvas drawing.
A separate preparation profile still measured substantial worker-result cloning;
large-board opening is not instant. Correctness checks cover tokenizer grammar,
cache invalidation and unchanged-frame DOM writes.


Part connectivity also uses a revision-bound reverse index of saved object IDs
and primitive owner UUIDs. Empty part searches skip connectivity lookup entirely.
On the same Marble model, querying all 1,006 footprints took a median 19,871.69 ms
with repeated net/geometry scans versus 1.19 ms after indexing (three runs;
3,946 matches in both cases). Building the index once took 124.36 ms. This
comparison isolates lookup work; it is not an end-to-end opening measurement.

### Native GitHub imports

Small GitHub blob imports preflight all paths, modes, object IDs and aggregate
sizes, then fetch at most three files concurrently. An 8 MiB aggregate in-flight
source reservation limits transient JSON/base64 decoding memory; larger files
run alone. Disk imports also use at most three workers with per-file/storage
reservations. Manifest order, pinned identities, validation, cancellation and
staging cleanup remain deterministic. GitLab transfers remain serial to preserve
its current refresh-token rotation behavior. Provider cache lookup no longer
holds the cancellation monitor while waiting on disk transfers.

Samsung SM_A366E native tests, six fake transfers with 120 ms delay per file:

| Transfer path | Serial | Concurrent (maximum 3) |
| --- | ---: | ---: |
| Disk download | 752 ms | 264 ms |
| Small GitHub blob decode/import | 735 ms | 255 ms |

These controlled device measurements isolate scheduling overhead and simulated
latency, not live GitHub throughput. Native checks cover aggregate quotas,
preflight rejection, ordered results, UTF-8/LFS/size validation, failures,
cancellation, stale authorization generations and joining writers before cleanup.

Reproduce current CPU stages with
`node extension/tests/viewer-performance.bench.cjs path/to/board.kicad_pcb`
(no source content is printed).
