# Changelog

Versions follow [semantic versioning](https://semver.org/). Before 1.0, minor versions (0.2, 0.3)
add the larger features on the roadmap and patch versions (0.1.1, 0.1.2) are fixes and polish.
The footer of the app shows the version and the exact commit it was built from.

## 0.1.1 (2026-11-03)

### Added
- Phone layout: the page gets the whole screen, with tools at the bottom and Export at the top.
  Pinch to zoom around your fingers, double-tap to zoom in and back to fit.
- Keyboard use: an "Add box" button, Enter on the page adds a box, arrow keys move it and
  Ctrl/⌘+Shift+arrows resize it. In Words mode the arrow keys walk the words and Enter blacks out
  the current one.
- Screen reader announcements for the current word and for each word blacked out.
- The browser asks before you close or reload the tab while you have unexported boxes.
- The footer shows the build's commit, and every deployed file has a signed build provenance
  record you can check with `gh attestation verify`.

### Changed
- Dialogs keep keyboard focus inside while open, close on Escape and return focus to where it was.
- Text, focus rings and the selected box meet WCAG AA contrast in light and dark mode.
- The check that the export contains nothing but images now runs off the main thread, so the page
  stays responsive while long PDFs export.

## 0.1.0 (2026-11-02)

First release. Redact PDFs and images entirely in the browser: draw boxes or black out whole words,
export a flattened copy with no text, metadata or hidden content, and check the result before
downloading it.
