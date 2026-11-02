import { useEffect, useState } from "react";
import type { LoadedDoc } from "../core/load";
import { canvasSize, createCanvas, get2d, releaseCanvas } from "../core/render";

const THUMB_WIDTH = 96;

interface Props {
  doc: LoadedDoc;
  current: number;
  counts: number[];
  onSelect: (page: number) => void;
  /** "rail": the desktop side column (and phone strip); "grid": inside the phone Pages sheet. */
  layout?: "rail" | "grid";
}

/** Page strip. Thumbnails render one at a time so a long PDF never holds many canvases at once. */
export function Thumbnails({ doc, current, counts, onSelect, layout = "rail" }: Props) {
  const [urls, setUrls] = useState<(string | undefined)[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    const made: string[] = [];
    (async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 0; i < doc.pages.length && !ac.signal.aborted; i++) {
        const size = doc.pages[i]!;
        const scale = (THUMB_WIDTH * dpr) / size.width;
        const { w, h } = canvasSize(size, scale);
        const canvas = createCanvas(w, h);
        try {
          await doc.draw(i, get2d(canvas), scale, ac.signal);
          const blob =
            "convertToBlob" in canvas
              ? await canvas.convertToBlob({ type: "image/png" })
              : await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
          if (!blob || ac.signal.aborted) break;
          const url = URL.createObjectURL(blob);
          made.push(url);
          setUrls((prev) => {
            const next = prev.slice();
            next[i] = url;
            return next;
          });
        } catch {
          break;
        } finally {
          releaseCanvas(canvas);
        }
      }
    })();
    return () => {
      ac.abort();
      made.forEach((u) => URL.revokeObjectURL(u));
      setUrls([]);
    };
  }, [doc]);

  return (
    <nav className={layout === "grid" ? "thumbs-grid" : "thumbs"} aria-label="Pages">
      <ol>
        {doc.pages.map((size, i) => (
          <li key={i}>
            <button
              type="button"
              className={`thumb${i === current ? " current" : ""}`}
              aria-current={i === current ? "page" : undefined}
              aria-label={`Page ${i + 1}${counts[i] ? `, ${counts[i]} boxes` : ""}`}
              onClick={() => onSelect(i)}
            >
              <span className="thumb-img" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
                {urls[i] && <img src={urls[i]} alt="" />}
              </span>
              <span className="thumb-label">
                {i + 1}
                {counts[i] ? <span className="badge">{counts[i]}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
