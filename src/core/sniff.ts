import type { DocKind } from "./types";

/** Identify a file by its first bytes; extensions and MIME types can lie. */
export function sniffKind(head: Uint8Array): DocKind | null {
  const at = (i: number) => head[i] ?? -1;
  const ascii = (from: number, s: string) => [...s].every((ch, i) => at(from + i) === ch.charCodeAt(0));
  // %PDF can appear after some junk; pdf.js accepts it within the first 1024 bytes.
  const scan = Math.min(head.length - 4, 1024);
  for (let i = 0; i <= scan; i++) if (ascii(i, "%PDF")) return "pdf";
  if (at(0) === 0x89 && ascii(1, "PNG")) return "image";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image";
  return null;
}
