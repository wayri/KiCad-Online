# Viewer acceptance for 0.12.95

Installed Chrome checks used the public projects below, loaded from GitHub through the website session with the extension review account signed out. The installed development package was based on 0.12.94 with the changes prepared for 0.12.95.

| Project | Saved revision | Observed behavior |
| --- | --- | --- |
| [KERO encoder](https://github.com/wayri/KERO/tree/7be8fef589bc28eee149323e3790ef95b0873032/encoder) | `7be8fef589bc28eee149323e3790ef95b0873032` | BoM opens beside the schematic; C1 opens bank1 and its saved object; selected net retains bright layer colors against near-gray context in light and dark Layout; 3D retains selection with 79 linked models; schematic/3D split and layer hover expansion work. |
| [Marble](https://github.com/BerkeleyLab/Marble/tree/a426777d92c0f22a546d4740b419a3937e0c1f90/design) | `a426777d92c0f22a546d4740b419a3937e0c1f90` | Direct extension-icon opening succeeds; native BoM contains 981 saved schematic symbols; grouped references wrap within their column; C1 opens FPGA_PWR&MISC and its saved object. |

The focused UI regression gate passed 481 checks. Full release gates and exact package checks are separate and must pass before publication.

## Remaining live coverage

Windows could not activate the test browser for the final checks. Marble Layout/internal-layer/3D, the complete popup-link matrix, canvas-to-BoM scrolling, final sidebar-aware layer placement and visibility-eye interactions remain unverified in the installed browser. Source regressions cover these paths but do not replace those live checks.

No new private/organization SSO, physical Android device or Firefox Android acceptance is claimed. The viewer respects website and organization access policies; this update does not bypass them. Altium beta remains separate. These checks do not establish full Altium viewer parity or qualify Fast DC drop as an engineering sign-off tool.
