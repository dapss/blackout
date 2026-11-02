import { useEffect, useRef, useState } from "react";
import { isUsableRect, moveRect, rectFromPoints, resizeRect } from "../core/geometry";
import type { LoadedDoc } from "../core/load";
import { canvasSize, createCanvas, get2d, releaseCanvas } from "../core/render";
import type { Box, Rect, ResizeHandle } from "../core/types";
import { type Word, wordAt, wordBox, lineRects, wordsInRect } from "../core/words";
import { addBox, newBoxId, updateBox } from "./history";

export type Tool = "draw" | "words";

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Scroll the nearest scrollable ancestors (the stage, then the page) by a pixel delta. */
function scrollAncestorsBy(el: HTMLElement, dx: number, dy: number): void {
  for (let n = el.parentElement; n && (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5); n = n.parentElement) {
    const left = n.scrollLeft;
    const top = n.scrollTop;
    n.scrollBy({ left: dx, top: dy, behavior: "instant" });
    dx -= n.scrollLeft - left;
    dy -= n.scrollTop - top;
  }
}

type Drag =
  | { mode: "draw"; x0: number; y0: number }
  | { mode: "sweep"; x0: number; y0: number }
  | { mode: "move"; id: string; x0: number; y0: number; origin: Rect }
  | { mode: "resize"; id: string; handle: ResizeHandle; x0: number; y0: number; origin: Rect };

interface Props {
  doc: LoadedDoc;
  pageIndex: number;
  zoom: number;
  tool: Tool;
  peek: boolean;
  boxes: Box[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (boxes: Box[]) => void;
  /** Reports how many words the current page's text layer has (null while loading). */
  onWordCount?: (count: number | null) => void;
}

export function PageView({
  doc,
  pageIndex,
  zoom,
  tool,
  peek,
  boxes,
  selectedId,
  onSelect,
  onChange,
  onWordCount,
}: Props) {
  const size = doc.pages[pageIndex]!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Live geometry while a pointer is down; committed to history on release. */
  const [draft, setDraft] = useState<{ id: string | null; rect: Rect } | null>(null);
  const [rendering, setRendering] = useState(true);
  const [words, setWords] = useState<Word[] | null>(null);
  const [hover, setHover] = useState<Word | null>(null);

  // Load the page's words when the Words tool is in use.
  useEffect(() => {
    setWords(null);
    setHover(null);
    if (tool !== "words") return;
    let live = true;
    onWordCount?.(null);
    void doc.words(pageIndex).then((w) => {
      if (!live) return;
      setWords(w);
      onWordCount?.(w.length);
    });
    return () => {
      live = false;
    };
  }, [doc, pageIndex, tool, onWordCount]);

  // Render off-screen, then copy, so a slow render never leaves a half-drawn page on screen.
  useEffect(() => {
    const visible = canvasRef.current;
    if (!visible) return;
    const ac = new AbortController();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const scale = zoom * dpr;
    const { w, h } = canvasSize(size, scale);
    const off = createCanvas(w, h);
    setRendering(true);
    doc
      .draw(pageIndex, get2d(off), scale, ac.signal)
      .then(() => {
        if (ac.signal.aborted) return;
        visible.width = w;
        visible.height = h;
        visible.getContext("2d")!.drawImage(off, 0, 0);
        setRendering(false);
      })
      .catch(() => {
        /* cancelled by a newer render */
      })
      .finally(() => releaseCanvas(off));
    return () => ac.abort();
  }, [doc, pageIndex, zoom, size]);

  const toPage = (e: React.PointerEvent): { x: number; y: number } => {
    const r = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const begin = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    capture(e.pointerId);
    drag.current = d;
  };

  const capture = (pointerId: number) => {
    try {
      layerRef.current!.setPointerCapture(pointerId);
    } catch {
      /* the pointer is already gone */
    }
  };

  // Touch: one finger draws or selects words, two fingers scroll. There is no separate scroll mode.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const panFrom = useRef<{ x: number; y: number } | null>(null);

  const touchMidpoint = () => {
    let x = 0;
    let y = 0;
    for (const t of touches.current.values()) {
      x += t.x;
      y += t.y;
    }
    return { x: x / touches.current.size, y: y / touches.current.size };
  };

  // Capture phase, so a second finger is seen even when it lands on a box.
  const onTouchDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size < 2) return;
    // A second finger: drop whatever the first one started (nothing was committed) and scroll.
    e.preventDefault();
    e.stopPropagation();
    capture(e.pointerId);
    drag.current = null;
    setDraft(null);
    panFrom.current = touchMidpoint();
  };

  /** Returns true when the event belonged to a two-finger scroll. */
  const trackTouch = (e: React.PointerEvent): boolean => {
    if (e.pointerType !== "touch" || !touches.current.has(e.pointerId)) return false;
    if (e.type === "pointermove") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!panFrom.current) return false;
      const m = touchMidpoint();
      scrollAncestorsBy(layerRef.current!, panFrom.current.x - m.x, panFrom.current.y - m.y);
      panFrom.current = m;
      return true;
    }
    touches.current.delete(e.pointerId);
    if (!panFrom.current) return false;
    // Lifting a finger ends the scroll; the remaining finger does nothing until it lifts too.
    if (touches.current.size === 0) panFrom.current = null;
    return true;
  };

  const onLayerDown = (e: React.PointerEvent) => {
    onSelect(null);
    const p = toPage(e);
    begin(e, tool === "words" ? { mode: "sweep", x0: p.x, y0: p.y } : { mode: "draw", x0: p.x, y0: p.y });
    setDraft({ id: null, rect: { x: p.x, y: p.y, w: 0, h: 0 } });
  };

  const onBoxDown = (e: React.PointerEvent, box: Box) => {
    onSelect(box.id);
    const p = toPage(e);
    begin(e, { mode: "move", id: box.id, x0: p.x, y0: p.y, origin: box });
  };

  const onHandleDown = (e: React.PointerEvent, box: Box, handle: ResizeHandle) => {
    const p = toPage(e);
    begin(e, { mode: "resize", id: box.id, handle, x0: p.x, y0: p.y, origin: box });
  };

  const rectAt = (d: Drag, e: React.PointerEvent): { id: string | null; rect: Rect } => {
    const p = toPage(e);
    if (d.mode === "draw" || d.mode === "sweep") return { id: null, rect: rectFromPoints(d.x0, d.y0, p.x, p.y, size) };
    if (d.mode === "move") return { id: d.id, rect: moveRect(d.origin, p.x - d.x0, p.y - d.y0, size) };
    return { id: d.id, rect: resizeRect(d.origin, d.handle, p.x - d.x0, p.y - d.y0, size) };
  };

  const onMove = (e: React.PointerEvent) => {
    if (trackTouch(e)) return;
    if (drag.current) setDraft(rectAt(drag.current, e));
    else if (words) {
      const p = toPage(e);
      setHover(wordAt(words, p.x, p.y) ?? null);
    }
  };

  /** Click a word: black it out, or select the box that already covers it. */
  const redactWordAt = (x: number, y: number) => {
    const word = words && wordAt(words, x, y);
    if (!word) return;
    const cx = word.x + word.w / 2;
    const cy = word.y + word.h / 2;
    const covering = boxes.find(
      (b) => b.page === pageIndex && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h,
    );
    if (covering) {
      onSelect(covering.id);
      return;
    }
    // Not selected afterwards: its handles would cover neighbouring words and catch the next tap.
    onChange(addBox(boxes, { id: newBoxId(), page: pageIndex, ...wordBox(word, size) }));
  };

  /** Drag across words: one box per line, so the gaps between words are covered too. */
  const redactWordsIn = (r: Rect) => {
    const picked = words ? wordsInRect(words, r) : [];
    if (!picked.length) return;
    let next = boxes;
    for (const line of lineRects(picked)) next = addBox(next, { id: newBoxId(), page: pageIndex, ...wordBox(line, size) });
    onChange(next);
  };

  const onUp = (e: React.PointerEvent) => {
    if (trackTouch(e)) return;
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    if (!d) return;
    // Use the release point itself: the last pointermove may not have rendered yet.
    const current = e.type === "pointercancel" ? null : rectAt(d, e);
    if (!current) return;
    if (d.mode === "sweep") {
      const tiny = current.rect.w * zoom < 4 && current.rect.h * zoom < 4;
      if (tiny) redactWordAt(d.x0, d.y0);
      else redactWordsIn(current.rect);
    } else if (d.mode === "draw") {
      // Ignore clicks and tiny accidental drags (under ~4 screen pixels).
      if (!isUsableRect(current.rect) || current.rect.w * zoom < 4 || current.rect.h * zoom < 4) return;
      const box: Box = { id: newBoxId(), page: pageIndex, ...current.rect };
      onChange(addBox(boxes, box));
      onSelect(box.id);
    } else {
      onChange(updateBox(boxes, d.id, current.rect));
    }
  };

  const shown = boxes
    .filter((b) => b.page === pageIndex)
    .map((b) => (draft && draft.id === b.id ? { ...b, ...draft.rect } : b));

  const px = (r: Rect) => ({ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom });

  // While sweeping, highlight the words the drag will take.
  const sweeping = draft && draft.id === null && tool === "words" ? draft.rect : null;
  const pending = new Set(sweeping && words ? wordsInRect(words, sweeping) : []);

  return (
    <div className="page" style={{ width: size.width * zoom, height: size.height * zoom }}>
      <canvas ref={canvasRef} className="page-canvas" aria-hidden="true" />
      {rendering && <div className="page-loading">Rendering…</div>}
      <div
        ref={layerRef}
        className={`layer tool-${tool}${peek ? " peek" : ""}`}
        data-testid="page-layer"
        aria-label={
          tool === "words"
            ? `Page ${pageIndex + 1}. Click a word or drag across words to black them out.`
            : `Page ${pageIndex + 1}. Drag to draw a redaction box.`
        }
        onPointerDownCapture={onTouchDownCapture}
        onPointerDown={onLayerDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
      >
        {tool === "words" &&
          words?.map((w, i) => (
            <span
              key={i}
              className={`word${w === hover ? " hover" : ""}${pending.has(w) ? " pending" : ""}`}
              data-testid="word"
              data-word={w.text}
              style={px(w)}
            />
          ))}
        {shown.map((b, i) => (
          <div
            key={b.id}
            className={`box${b.id === selectedId ? " selected" : ""}`}
            data-testid="box"
            style={px(b)}
            role="button"
            tabIndex={0}
            aria-label={`Redaction box ${i + 1}`}
            aria-pressed={b.id === selectedId}
            onFocus={() => onSelect(b.id)}
            onPointerDown={(e) => onBoxDown(e, b)}
          >
            {b.id === selectedId &&
              HANDLES.map((h) => (
                <span
                  key={h}
                  className={`handle h-${h}`}
                  data-handle={h}
                  onPointerDown={(e) => onHandleDown(e, b, h)}
                />
              ))}
          </div>
        ))}
        {draft && draft.id === null && (
          <div className={sweeping ? "sweep" : "box draft"} style={px(draft.rect)} />
        )}
      </div>
    </div>
  );
}
