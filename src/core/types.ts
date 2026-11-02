/** A rectangle in page units (PDF points for PDFs, pixels for images), origin top-left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A redaction box drawn by the user on one page (0-based index). */
export interface Box extends Rect {
  id: string;
  page: number;
}

export interface PageSize {
  width: number;
  height: number;
}

export type DocKind = "pdf" | "image";

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
