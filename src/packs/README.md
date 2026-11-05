# Detection packs

Each folder is one pack: `src/packs/<cc>/index.ts` for a country, `intl` for formats used everywhere. A pack is a list of detectors:

```ts
import { NUMBER_GROUPS, type Pack } from "../types";

export const id: Pack = {
  id: "id",
  name: "Indonesia",
  detectors: [
    { id: "id.nik", label: "NIK (Indonesian ID)", pattern: NUMBER_GROUPS, groups: [16, 16], validator: "nik" },
  ],
};
```

See `types.ts` for what each field means.

## Adding a pack

1. Add `src/packs/<cc>/index.ts`.
2. If the format has a checksum or a checkable structure, add the check to `validators.ts` and refer to it by name.
3. List the pack in `index.ts`. Earlier detectors win when two match the same text, so detectors with real checks go first. Mark a detector with no real check `loose`, so it runs last.
4. Add tests to `tests/unit/detect.test.ts`, with values that must not be flagged as well as ones that must. Use made-up values, never real people's numbers.

## What makes a good detector

- **Strict beats broad.** A panel full of wrong findings teaches people to click "Redact all" without reading. If a format has no checksum, require a distinctive layout or check that its parts make sense. A bare string of digits isn't enough.
- **No network, no models.** Packs are plain code in the bundle, and the page isn't allowed to fetch anything anyway.
- **Keep the pattern simple.** It runs on text from untrusted PDFs, so bound its repeats and avoid nesting them.
