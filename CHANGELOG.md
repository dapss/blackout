# Changelog

What changed in each version of [Blackout](https://blackout-redact.pages.dev). The footer of the app
shows which version you are using.

Versions follow [semantic versioning](https://semver.org/). Before 1.0, minor versions (0.2, 0.3)
bring the larger new features and patch versions (0.1.1, 0.1.2) bring fixes and polish.

## Unreleased

### Added
- A magnifier on touch screens: while you drag, it shows what's under your finger, so you can see
  exactly where a box starts and ends.
- An action bubble next to the selected box on phones, with Delete, and in Words mode "Fit to words",
  which shrinks a rough box onto the words under it.
- In Words mode, a straight drag along a line of text blacks out the words it crosses, like running
  a marker over them.
- Words mode says "Finding the words on this page…" until it's ready.
- Preview builds say so: the footer shows a "Preview build" label that links to the released
  version, so nobody mistakes unreleased changes for a release.

### Changed
- Your phone's browser bar matches the app's colours.
- Buttons respond to a press without the grey flash on iPhone.
- Animations turn off if you've asked your device to reduce motion.
- Typographic apostrophes throughout the app's text.

### Maintenance
- New changes go to a preview site first; the live site only updates when a version is released.

## 0.1.2 (2026-11-03)

### Changed
- Faster when you come back: the app now stays in your browser's cache, so a return visit opens
  straight away instead of checking every file with the server. A new version is still picked up
  as soon as it is released.
- The README explains why the exported PDF is pictures of the pages, and why that is safer.

### Maintenance
- Updated the build and deploy pipeline to current GitHub Actions versions.

## 0.1.1 (2026-11-03)

### Added
- A phone layout: the page gets the whole screen, with the tools at the bottom within thumb reach
  and Export at the top. Pinch to zoom where your fingers are, double-tap to zoom in and again to
  go back.
- Full keyboard use: add a box with the "Add box" button or Enter, move it with the arrow keys and
  resize it with Ctrl/⌘+Shift+arrows. In Words mode the arrow keys step through the words and Enter
  blacks out the current one.
- Screen readers announce the current word and each word you black out.
- Your browser asks before you close or reload the tab while you have boxes, so a stray reload
  doesn't lose your work.
- You can check that the site runs this project's code: the footer shows the exact version and
  commit, and every file is signed when it is built. The README's "Verify this copy" section
  explains how.

### Changed
- Pop-up panels (Export, Pages, Private) keep keyboard focus inside while open, close with Escape
  and return you to where you were.
- Easier to read: text, focus outlines and the selected box have stronger contrast, in light and
  dark mode.
- The page stays responsive while a long PDF is checked after export.

## 0.1.0 (2026-11-02)

First release. Redact PDFs and images entirely in your browser: draw boxes or black out whole words,
export a flattened copy with no text, metadata or hidden content, and have it checked before you
download it.
