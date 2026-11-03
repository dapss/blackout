# Blackout

**Redact PDFs and images entirely in your browser. Nothing is uploaded, nothing is stored.**

Online tools like iLovePDF, Smallpdf or Acrobat online make you upload a document before they can redact it. Blackout does the whole job on your own device: the file is opened, flattened and checked inside the browser tab, and the page is not allowed to send data anywhere.

Made by [Mochamad Daffa](https://github.com/dapss). Licensed under [Apache-2.0](LICENSE).

**Try it: [blackout-redact.pages.dev](https://blackout-redact.pages.dev)**

## What it does

- Open a PDF, PNG, JPEG or WebP (drag and drop or file picker).
- Page thumbnails, zoom, and page navigation.
- **Draw** black boxes with a mouse, pen or finger. Select, move, resize and delete them, with undo and redo (Ctrl+Z, Ctrl+Shift+Z, Delete, arrow keys to nudge).
- **Words** (PDFs with a text layer): click a word to black it out, or drag across several words. A drag makes one box per line, so the gaps between words are covered too. The text layer says which words are on a line. The rendered pixels say exactly where they are: each box is fitted to the word's actual ink, so it stays exact on justified, letter-spaced, condensed or kerned text, where PDF text positions are often several points off. When the ink is ambiguous (an underline running through the line, for example), Blackout falls back to a wider, padded box. Word boxes are ordinary boxes, so you can still adjust them. Images and scanned pages have no text layer, so use Draw for those.
- **Safe-mode export.** Every page is rendered to an image at 200 DPI, the boxes are burned into the pixels, and a brand-new PDF is built from those images. Nothing is copied from the original: no text layer, fonts, metadata, annotations, links, form fields, attachments, JavaScript or earlier revisions. Images are re-encoded as PNG, which drops EXIF data (including GPS location).
- **Checked before download.** The output is re-opened and inspected. The download is only offered if every check passes, for example `Verified: 0 of 14 redacted items recoverable`:
  - no extractable text on any page (pdf.js `getTextContent`)
  - every box is solid black when the output is rendered again
  - no Info dictionary or XMP metadata, annotations, form fields, attachments, scripts or actions
  - pages contain images only (no fonts or vector content)
  - one revision only (no incremental updates hiding older content)
  - for images: no EXIF or text chunks in the PNG

**Trade-off: the exported PDF is pictures of the pages.** Its text can't be selected, searched or copied, and the file is usually larger than the original. This is on purpose: text that isn't in the file can't leak, whether through a box drawn slightly off, hidden text under the visible page, or a copy-paste. Keep your original if you need the searchable version. A second export mode is planned that keeps the rest of the text searchable and removes only what is under your boxes. It will sit alongside this one, and safe mode will stay the default.

## How to verify nothing is uploaded

You don't have to trust this README:

1. **Airplane mode.** Load the page, then disconnect from the internet. Open, redact and export a file. Everything still works, because the app never needs the network after it has loaded.
2. **Network tab.** Open your browser's developer tools (F12), go to *Network*, and use the app. No request is made when you open, edit or export a file.
3. **Content Security Policy.** The page ships with `connect-src 'self'` (as an HTTP header via `_headers`, and as a `<meta>` tag), so the browser itself blocks any attempt to send data to another server.
4. **Read and build the code.** There is no backend in this repository. Build it yourself and compare.

The end-to-end tests check points 1 to 3 automatically. See [SECURITY.md](SECURITY.md) for what Blackout does and doesn't guarantee.

## Verify this copy

The checks above cover what the page does. This one covers *which code* you got: that the files [blackout-redact.pages.dev](https://blackout-redact.pages.dev) serves were built from this repository, and not changed along the way.

- **See the version.** The footer shows the version and commit, for example `v0.1.1 · af8c9f7`, and links to that commit's source. [CHANGELOG.md](CHANGELOG.md) lists what changed in each version.
- **Check the signatures.** Every deploy is built by [this repo's GitHub Actions workflow](.github/workflows/deploy.yml), which signs each file with GitHub's build provenance (Sigstore) before uploading it. With the [GitHub CLI](https://cli.github.com) installed:

  ```bash
  bash scripts/verify-live.sh
  ```

  It downloads the page, its script and stylesheet, and both workers, then checks each against the signatures on this repo and prints the commit it was built from. To check a single file by hand:

  ```bash
  curl -sO https://blackout-redact.pages.dev/favicon.svg
  gh attestation verify favicon.svg --repo dapss/blackout
  ```

  A file that wasn't built by this workflow fails the check.

## Run it locally

Requires Node.js 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # static site in dist/
pnpm preview      # serve the production build
```

## Tests

```bash
pnpm test                                   # Vitest unit tests (geometry, undo/redo, verifier, CSP)
pnpm exec playwright install chromium firefox webkit   # once
pnpm test:e2e                               # Playwright, against the production build
pnpm fixtures                               # regenerate the test PDFs in tests/fixtures
```

On Windows, if your user folder has a space in it (`C:\Users\First Last`), Playwright's Firefox may fail to start with `spawn UNKNOWN`. Install the browsers to a path without spaces instead: set `PLAYWRIGHT_BROWSERS_PATH=C:\pw-browsers` before both the install and the test run.

The Playwright suite runs in Chromium (Chrome and Edge), Firefox and WebKit (Safari), plus phone-sized Chrome and Safari. It covers: zero text in exported PDFs, no metadata, annotations, attachments or forms, no EXIF in exported images, no network requests after the initial load (offline), the CSP, the download being blocked when the check fails, box editing with undo and redo, phone-width layout, and a 20-page export that never blocks the main thread for long.

## How it works

```
src/
├─ app/                React UI: viewer, thumbnails, box editor, export dialog
├─ core/
│  ├─ load.ts          open PDFs (pdf.js) and images (createImageBitmap)
│  ├─ render.ts        canvases and size limits
│  ├─ redact-safe.ts   flatten each page, burn in boxes, hand pages to the encoder
│  ├─ encode.ts        JPEG/PNG encoding and the new PDF (pdf-lib)
│  ├─ verify.ts        re-open the output and check it
│  ├─ words.ts         word positions from the PDF text layer (Words tool)
│  └─ geometry.ts      box math
└─ workers/            export worker (encoding + PDF assembly off the main thread)
```

Pages are rendered and encoded one at a time and every canvas is released straight away, so long PDFs don't run out of memory. Encoding and assembly run in a Web Worker with `OffscreenCanvas` (with a main-thread fallback for older browsers). pdf.js parses in its own worker and runs with no font, CMap or wasm URLs, so it never fetches anything.

## License and credit

Apache-2.0. Copyright 2026 Mochamad Daffa. If you reuse or redistribute this code, keep the [NOTICE](NOTICE) file.
