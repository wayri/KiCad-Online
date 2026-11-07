# Demo board acknowledgements

Thank you to the authors and contributors who publish the designs used to demonstrate and test KiCad Online. The boards are their work; the screenshots demonstrate this viewer.

| Public design | Credit and source | Where it is used |
| --- | --- | --- |
| ESP32-PoE, hardware revision M2 | [OLIMEX and contributors](https://github.com/OLIMEX/ESP32-POE/tree/deb38a377d50eadb04ddc7118a17a5ae58b1ee53/HARDWARE/ESP32-PoE-hardware-revision-M2) | Schematic, PCB, linked 3D models, cross-probing and review demonstrations in the 0.12.79, 0.12.80, 0.12.83 and 0.12.85 galleries. |
| Marble | [Berkeley Lab and Marble contributors](https://github.com/BerkeleyLab/Marble/tree/a426777d92c0f22a546d4740b419a3937e0c1f90/design) | Complex-board, sheet-hierarchy, cross-sheet net and Android examples. Older 3D captures use labelled approximate bodies. |
| FMCW3 radar | [Ttl/FMCW3 authors and contributors](https://github.com/Ttl/fmcw3/tree/e57ce3bd46c862798b6acc4206564233bcbd5aaf) | Real-board layout examples in the 0.12.79 gallery. |
| HP34401a OLED iBOM demo | [OpenScopeProject / InteractiveHtmlBom demo authors](https://openscopeproject.org/InteractiveHtmlBomDemo/html/hp34401a_oled.html) | The 0.12.91 comparison captures derive CSV rows from the retained public demo; R1 is changed from 100k to 110k as a labelled controlled edit. |
| PIC Programmer | [KiCad demo authors and contributors](https://github.com/KiCad/kicad-source-mirror/tree/29798a640054e91411a44d230bd3a3425b3166e4/demos/pic_programmer) | Browser and VS Code screenshots, Draftsman, BoM, local comment examples, linked-model rendering and experimental Fast PI demonstrations. Some historical captures use the demo distributed with the installed KiCad 10 version; their source notes identify that separately. |

These links identify the recorded public source snapshots. Per-capture manifests and captions remain authoritative for the exact inputs, viewer version, model coverage and limitations: [image provenance](images/README.md), [0.12.79](images/0.12.79/capture-manifest.json), [0.12.80](images/0.12.80/capture-manifest.json), [0.12.83](images/0.12.83/capabilities/capture-manifest.json), [0.12.85](BRAND-SCREENSHOTS-0.12.85.md) and [VS Code screenshot sources](../vscode-extension/images/SCREENSHOT-SOURCES.md).

## Separate Altium beta test inputs

Thanks to **Lime Microsystems, Myriad-RF and the [LimeSDR-USB contributors](https://github.com/myriadrf/LimeSDR-USB/tree/c6ea7cea27b90e94625b8e49b71ee2a10a5345bb/hardware/plug/1v4)** for the public v1.4 Altium schematics used in the separate beta screenshot collection: block diagram, LMS7002M RF1, USB 3.0 device and board power supply. These were opened locally at the pinned revision; this does not establish installed-extension repository transport or full board fidelity.

The unreleased Altium experiment has also used the [SimpleFOC Mini design and its contributors](https://github.com/simplefoc/SimpleFOCMini/blob/8e10d4ba398624bd0ef970e82c03d7a6bcc2220d/Altium/simplefocmini_2024-04-26.pcbdoc), and the public BeaglePlay power-tree and power-supply parser fixtures distributed by [tscircuit/altiumts](https://github.com/tscircuit/altiumts/tree/144f597984495285fe6ea82dec6c6a8b041e9add). Thanks to those design authors and fixture contributors. These are separate beta tests, not Altium support in the released KiCad packages. The experiment's source notes retain the file-level provenance.

## Other public regression inputs

Thanks also to the [Ttl/VNA2 contributors](https://github.com/Ttl/vna2/tree/2cf0efb22da56a168a7f07bf5e2c30631343997b/hw) for the legacy design used in compatibility regression checks, and the KiCad authors of the [8.0.0 QA corpus](https://github.com/KiCad/kicad-source-mirror/tree/8.0.0/qa). These are test inputs, not claims that their projects have been reviewed or endorsed. Their retained fixture notes record the exact source and any excerpting.

## Rights and interpretation

Designs, embedded artwork and component models retain their respective copyright notices and upstream license terms. KiCad Online's software license does not relicense them. Consult the linked upstream projects and individual files before reusing or distributing their design assets. Software dependency notices are maintained separately in [Third-party notices](../THIRD-PARTY-NOTICES.md).

Acknowledgement does not imply affiliation, sponsorship, endorsement or approval of this viewer or its analysis results. Local review messages, assembly checklists and simulation assumptions shown in demonstrations are example data unless a caption explicitly states otherwise. Synthetic test boards are identified as fixtures and are not attributed to these upstream hardware projects.
