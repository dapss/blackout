// Touch magnifier: shows what's under the finger while it drags, since the finger itself hides it.
import { type RefObject, useLayoutEffect, useRef } from "react";
import { LOUPE_SIZE, loupeSpot } from "../core/geometry";
import type { PageSize, Rect } from "../core/types";

const MAGNIFY = 2.5;

interface Props {
  source: RefObject<HTMLCanvasElement | null>;
  size: PageSize;
  zoom: number;
  peek: boolean;
  finger: { cx: number; cy: number; px: number; py: number };
  boxes: Rect[];
  active: Rect | null;
  highlights: Rect[];
}

export function Loupe({ source, size, zoom, peek, finger, boxes, active, highlights }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    const page = source.current;
    if (!canvas || !page || !page.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = canvas.height = LOUPE_SIZE * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#808080"; // off the page's edge
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = zoom * MAGNIFY * dpr;
    const middle = (LOUPE_SIZE * dpr) / 2;
    ctx.setTransform(scale, 0, 0, scale, middle - finger.px * scale, middle - finger.py * scale);
    ctx.drawImage(page, 0, 0, size.width, size.height);
    ctx.fillStyle = "#000";
    ctx.globalAlpha = peek ? 0.55 : 1;
    for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = "#f5c400";
    ctx.globalAlpha = 0.45;
    for (const w of highlights) ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.globalAlpha = 1;
    if (active) {
      ctx.strokeStyle = "#f5c400";
      ctx.lineWidth = (2 * dpr) / scale;
      ctx.strokeRect(active.x, active.y, active.w, active.h);
    }

    // Crosshair, white under black so it shows on both text and black boxes.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = LOUPE_SIZE / 2;
    for (const [color, width] of [["#fff", 3], ["#000", 1]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(c - 9, c);
      ctx.lineTo(c + 9, c);
      ctx.moveTo(c, c - 9);
      ctx.lineTo(c, c + 9);
      ctx.stroke();
    }
  });

  return (
    <canvas
      ref={ref}
      className="loupe"
      data-testid="loupe"
      aria-hidden="true"
      style={{ ...loupeSpot(finger.cx, finger.cy, window.innerWidth, window.innerHeight), width: LOUPE_SIZE, height: LOUPE_SIZE }}
    />
  );
}
