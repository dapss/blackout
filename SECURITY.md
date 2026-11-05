# Security

## What Blackout guarantees

- **Your file stays on your device.** Files are read, rendered, redacted and checked inside your browser tab. There is no server component, no upload, no analytics and no storage of documents. Documents live in memory only and are gone when you close or reload the tab.
- **The page can't phone home.** The Content Security Policy sets `connect-src 'self'`, so the browser blocks requests to any other origin. After the initial load the app makes no network requests at all and works offline.
- **Safe-mode output contains no original text, metadata or hidden layers.** Every page is rasterized, boxes are painted fully opaque into the pixels, and a new PDF is assembled from the page images. Text, fonts, the Info dictionary, XMP metadata, annotations, links, form fields, attachments, JavaScript, actions and earlier revisions are not carried over. Exported images are re-encoded as PNG with no EXIF or text chunks.
- **Every export is checked.** The output is re-opened and inspected (text extraction, structure, metadata, a pixel check of every box). If any check fails, the download is blocked.

## What Blackout does not guarantee

- **That you found everything.** Find items is a helper, not a guarantee. It only looks for emails, phone numbers, card numbers, IBANs and Indonesian NIK and NPWP numbers, in text the PDF exposes as selectable, one line at a time. It misses other kinds of sensitive information (names, addresses, signatures, photos), text in images and scans, values in formats it doesn't know, values split across lines, and text the PDF stores in a way that doesn't match what you see. You are responsible for covering every sensitive item; review each page before exporting.
- **Protection from a compromised device.** Malware, a malicious browser extension or a tampered browser can read anything on the page, including your document.
- **That nothing can be inferred from what's left.** The length of a box, the text around it, or pixels right next to its edge can hint at what was covered. Draw boxes generously. Blackout adds a small pad around every box, but it can't judge context.
- **Protection of the original file.** Blackout never modifies or deletes your original. Keep it safe or delete it yourself.
- **Hosting you don't control.** If you use a copy hosted by someone else, you trust that host to serve the real code. The official copy at blackout-redact.pages.dev can be checked: every file it serves is signed with GitHub build provenance, and `scripts/verify-live.sh` verifies the files you received (see "Verify this copy" in the README). That proves what *you* were served, not what someone else was. For the strongest guarantee, build and serve it yourself.

## Known limitations

- Fonts that aren't embedded in a PDF are drawn with system fonts, so the preview can differ slightly from other viewers. Boxes still cover exactly what you see, because the export uses the same rendering.
- Password-protected PDFs aren't supported yet.
- Very large pages are rendered below 200 DPI to stay within browser canvas limits.

## Reporting a vulnerability

Please report security problems privately via GitHub's "Report a vulnerability" (Security tab) on [github.com/dapss/blackout](https://github.com/dapss/blackout), rather than in a public issue. Include a sample file if you can, ideally one with no real personal data. Especially welcome: any input file where Blackout's output still contains recoverable text, metadata or content under a box.
