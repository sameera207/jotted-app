# Mockups

The desktop app's screens, exported from the "Jotted desktop app" design canvas
(https://claude.ai/artifact/41a9qePZqcgRrM9WPSL6wd). The spec (`specs/Desktop-app-spec.md`) refers to them by number.

| # | Screen | Image | Static page | Canvas board |
| --- | --- | --- | --- | --- |
| 1 | To-do window | `01-todo.png` | `01-todo.html` | `Main.dc.html` |
| 2 | Where it came from | `02-where-it-came-from.png` | `02-where-it-came-from.html` | `SourcePeek.dc.html` |
| 3 | Notebooks | `03-notebooks.png` | `03-notebooks.html` | none: from the "Jotted Notebooks Picker" artifact (https://claude.ai/artifact/PkYhYt6dznvDN4Wgq3LmLN); `Notebooks.dc.html` is the earlier card grid |
| 4 | Settings | `04-settings.png` | `04-settings.html` | `Settings.dc.html` |
| 5 | Welcome | `05-welcome.png` | `05-welcome.html` | `Welcome.dc.html` |
| 6 | Setup: connect your reMarkable | `06-setup-connect.png` | `06-setup-connect.html` | `SetupConnect.dc.html` |
| 7 | Setup: model and plugin keys | `07-setup-model-and-plugins.png` | `07-setup-model-and-plugins.html` | `Onboarding.dc.html` |
| 8 | Tray / menu bar popover | `08-tray.png` | `08-tray.html` | `Tray.dc.html` |

- The PNGs are at 2× scale. The static pages open in any browser, with the fonts embedded; they show each screen's first state and aren't interactive.
- `source/` holds the canvas files (`.dc.html` and `canvas.json`), the design's source of truth. Edit the canvas, then export again.
- Sample names, items and the handwriting font are stand-ins. The app shows real ink as SVG from `jotted image line` / `image page`.
- `03-notebooks.html` is the interactive folder-picker mockup (`specs/Notebooks-folder-picker-spec.md`), not a canvas export: it loads IBM Plex from Google Fonts, and its PNG is a 2× render of the window.
