import { useEffect, useMemo, useRef, useState } from "react";
import { bubbleSpot, isUsableRect, moveRect, rectFromPoints, resizeRect } from "../core/geometry";
import type { LoadedDoc } from "../core/load";
import { canvasSize, createCanvas, get2d, releaseCanvas } from "../core/render";
import type { Box, Rect, ResizeHandle } from "../core/types";
import { groupLines, type Word, wordAt, wordBox, lineRects, wordsInRect } from "../core/words";
import { addBox, newBoxId, updateBox } from "./history";
import { Loupe } from "./Loupe";
import { scrollAncestorsBy } from "./scroll";

export type Tool = "draw" | "words";

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Two taps closer than this (ms, screen px) are a double-tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
/** While zoom is changing (pinch), re-render the page this long after it settles; it stretches meanwhile. */
const RENDER_SETTLE_MS = 150;
/** A finger moving less than this (screen px) is tapping, not dragging. */
const TAP_PX = 6;
/** A box within this many page units of its fitted size already fits. */
const FIT_TOLERANCE = 1;

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
  /** Pinch: zoom to `zoom`, keeping the page point under (cx, cy) in place. */
  onPinchZoom?: (zoom: number, cx: number, cy: number) => void;
  onDoubleTap?: (cx: number, cy: number) => void;
  /** Keyboard: Enter on the page in Draw mode adds a box in the middle of the view. */
  onAddBox?: () => void;
  onTwoFingers?: () => void;
  /** Findings to show on the page while they're being reviewed. */
  marks?: { key: string; id: string; rect: Rect; active: boolean }[];
  /** Scroll this finding into view; a new object scrolls again. */
  focusMark?: { id: string } | null;
  /** Phone layout: show the action bubble next to the selected box. */
  bubble?: boolean;
  onDeleteSelected?: () => void;
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
  onPinchZoom,
  onDoubleTap,
  onAddBox,
  onTwoFingers,
  marks,
  focusMark,
  bubble,
  onDeleteSelected,
}: Props) {
  const size = doc.pages[pageIndex]!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Live geometry while a pointer is down; committed to history on release. */
  const [draft, setDraft] = useState<{ id: string | null; rect: Rect } | null>(null);
  /** True until this page has been drawn once; later re-renders (zoom) keep the old pixels showing. */
  const [rendering, setRendering] = useState(true);
  const [words, setWords] = useState<Word[] | null>(null);
  const [hover, setHover] = useState<Word | null>(null);
  /** The finger while it drags; shows the magnifier. */
  const [finger, setFinger] = useState<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  /** The box tapped to show its action bubble. Finishing a new box doesn't: the bubble would cover the text around it. */
  const [bubbleFor, setBubbleFor] = useState<string | null>(null);

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

  // The canvas is re-rendered at renderZoom; during a pinch the page stretches to the live zoom and
  // only re-renders once the fingers settle, so the gesture stays smooth.
  const [renderZoom, setRenderZoom] = useState(zoom);
  useEffect(() => {
    if (zoom === renderZoom) return;
    const t = setTimeout(() => setRenderZoom(zoom), RENDER_SETTLE_MS);
    return () => clearTimeout(t);
  }, [zoom, renderZoom]);

  useEffect(() => setRendering(true), [doc, pageIndex]);

  // Render off-screen, then copy, so a slow render never leaves a half-drawn page on screen.
  useEffect(() => {
    const visible = canvasRef.current;
    if (!visible) return;
    const ac = new AbortController();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const scale = renderZoom * dpr;
    const { w, h } = canvasSize(size, scale);
    const off = createCanvas(w, h);
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
  }, [doc, pageIndex, renderZoom, size]);

  useEffect(() => {
    if (focusMark) layerRef.current?.querySelector(`[data-finding-id="${focusMark.id}"]`)?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [focusMark, pageIndex]);

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
    dragStart.current = { x: e.clientX, y: e.clientY };
  };

  const capture = (pointerId: number) => {
    try {
      layerRef.current!.setPointerCapture(pointerId);
    } catch {
      /* the pointer is already gone */
    }
  };

  // Touch: one finger draws or selects words; two fingers scroll and pinch-zoom. No separate modes.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  /** A word tap waiting to see whether a second tap makes it a double-tap. */
  const pendingTap = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  useEffect(() => () => clearTimeout(pendingTap.current?.timer), []);

  const fingerSpread = () => {
    const [a, b] = [...touches.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

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
    setFinger(null);
    panFrom.current = touchMidpoint();
    pinch.current = { d0: fingerSpread(), z0: zoom };
    onTwoFingers?.();
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
      const pz = pinch.current;
      const d = fingerSpread();
      if (pz && pz.d0 > 0 && d > 0 && onPinchZoom) {
        const next = pz.z0 * (d / pz.d0);
        if (Math.abs(next - zoom) / zoom > 0.01) onPinchZoom(next, m.x, m.y);
      }
      return true;
    }
    touches.current.delete(e.pointerId);
    if (!panFrom.current) return false;
    // Lifting a finger ends the scroll; the remaining finger does nothing until it lifts too.
    if (touches.current.size === 0) {
      panFrom.current = null;
      pinch.current = null;
    }
    return true;
  };

  const onLayerDown = (e: React.PointerEvent) => {
    onSelect(null);
    setBubbleFor(null);
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
    if (drag.current) {
      setDraft(rectAt(drag.current, e));
      const moved = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y);
      if (e.pointerType === "touch" && (finger || moved >= TAP_PX)) {
        const p = toPage(e);
        setFinger({ cx: e.clientX, cy: e.clientY, px: p.x, py: p.y });
      }
    } else if (words) {
      const p = toPage(e);
      setHover(wordAt(words, p.x, p.y) ?? null);
    }
  };

  /**
   * A tap on touch. Returns true when it completed a double-tap (zoom), which the caller then
   * doesn't treat as a tap.
   */
  const isDoubleTap = (e: React.PointerEvent): boolean => {
    if (e.pointerType !== "touch" || !onDoubleTap) return false;
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      clearTimeout(pendingTap.current?.timer);
      pendingTap.current = null;
      onDoubleTap(e.clientX, e.clientY);
      return true;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    return false;
  };

  /** Click a word: black it out, or select the box that already covers it. */
  const redactWordAt = (x: number, y: number): "added" | "covered" | null => {
    const word = words && wordAt(words, x, y);
    if (!word) return null;
    const cx = word.x + word.w / 2;
    const cy = word.y + word.h / 2;
    const covering = boxes.find(
      (b) => b.page === pageIndex && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h,
    );
    if (covering) {
      onSelect(covering.id);
      return "covered";
    }
    // Not selected afterwards: its handles would cover neighbouring words and catch the next tap.
    onChange(addBox(boxes, { id: newBoxId(), page: pageIndex, ...wordBox(word, size) }));
    return "added";
  };

  // --- Keyboard: the page is one Tab stop; in Words mode arrow keys walk the words. ---

  /** Words in reading order, grouped by line. */
  const lines = useMemo(() => {
    if (!words) return [];
    return groupLines(words)
      .map((line) => [...line].sort((a, b) => a.x - b.x))
      .sort((a, b) => Math.min(...a.map((w) => w.y)) - Math.min(...b.map((w) => w.y)));
  }, [words]);
  const ordered = useMemo(() => lines.flat(), [lines]);
  const [cursor, setCursor] = useState<Word | null>(null);
  const [announce, setAnnounce] = useState("");
  useEffect(() => setCursor(null), [words]);

  const moveCursor = (next: Word | undefined) => {
    if (!next) return;
    setCursor(next);
    setAnnounce(`${next.text}, word ${ordered.indexOf(next) + 1} of ${ordered.length}`);
    const el = layerRef.current?.querySelector<HTMLElement>(`[data-word-index="${words?.indexOf(next)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onLayerKey = (e: React.KeyboardEvent) => {
    if (e.target !== layerRef.current || e.ctrlKey || e.metaKey || e.altKey) return;
    if (tool === "draw") {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onAddBox?.();
      }
      return;
    }
    if (!ordered.length) return;
    const current = cursor && ordered.includes(cursor) ? cursor : null;
    const i = current ? ordered.indexOf(current) : -1;
    const lineIndex = current ? lines.findIndex((l) => l.includes(current)) : -1;
    /** The word on another line closest (horizontally) to the current one. */
    const onLine = (li: number) => {
      const line = lines[li];
      if (!line) return undefined;
      const cx = current ? current.x + current.w / 2 : 0;
      return [...line].sort((a, b) => Math.abs(a.x + a.w / 2 - cx) - Math.abs(b.x + b.w / 2 - cx))[0];
    };
    let handled = true;
    if (e.key === "ArrowRight") moveCursor(ordered[Math.min(i + 1, ordered.length - 1)]);
    else if (e.key === "ArrowLeft") moveCursor(ordered[Math.max(i - 1, 0)]);
    else if (e.key === "ArrowDown") moveCursor(onLine(Math.min(lineIndex + 1, lines.length - 1)));
    else if (e.key === "ArrowUp") moveCursor(onLine(Math.max(lineIndex - 1, 0)));
    else if (e.key === "Home") moveCursor(ordered[0]);
    else if (e.key === "End") moveCursor(ordered[ordered.length - 1]);
    else if ((e.key === "Enter" || e.key === " ") && current) {
      const result = redactWordAt(current.x + current.w / 2, current.y + current.h / 2);
      setAnnounce(result === "added" ? `${current.text} blacked out` : `${current.text} is already covered`);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      // Keep the arrow keys from also moving a selected box (Editor listens on window).
      e.stopPropagation();
    }
  };

  // Delayed taps call the latest version, so they see the boxes as they are when they fire.
  const redactRef = useRef(redactWordAt);
  redactRef.current = redactWordAt;

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
    setFinger(null);
    if (!d) return;
    // Use the release point itself: the last pointermove may not have rendered yet.
    const current = e.type === "pointercancel" ? null : rectAt(d, e);
    if (!current) return;
    const tiny = current.rect.w * zoom < 4 && current.rect.h * zoom < 4;
    if ((d.mode === "sweep" || d.mode === "draw") && tiny && isDoubleTap(e)) return;
    if (d.mode === "sweep") {
      if (!tiny) redactWordsIn(current.rect);
      else if (e.pointerType === "touch" && onDoubleTap) {
        // Wait briefly: a second tap on the same spot turns this into a double-tap zoom instead.
        // A tap elsewhere first completes the earlier one.
        const prev = pendingTap.current;
        if (prev) {
          clearTimeout(prev.timer);
          redactRef.current(prev.x, prev.y);
        }
        const timer = setTimeout(() => {
          pendingTap.current = null;
          redactRef.current(d.x0, d.y0);
        }, DOUBLE_TAP_MS);
        pendingTap.current = { timer, x: d.x0, y: d.y0 };
      } else redactWordAt(d.x0, d.y0);
    } else if (d.mode === "draw") {
      // Ignore clicks and tiny accidental drags (under ~4 screen pixels).
      if (!isUsableRect(current.rect) || current.rect.w * zoom < 4 || current.rect.h * zoom < 4) return;
      const box: Box = { id: newBoxId(), page: pageIndex, ...current.rect };
      onChange(addBox(boxes, box));
      onSelect(box.id);
    } else {
      // A tap opens the bubble, and a finger's small wobble doesn't count as moving the box. That goes
      // for handles too: on touch their grab areas can cover a small box completely.
      const moved = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y);
      if (moved < (e.pointerType === "touch" ? TAP_PX : 1)) setBubbleFor(d.id);
      else onChange(updateBox(boxes, d.id, current.rect));
    }
  };

  const shown = boxes
    .filter((b) => b.page === pageIndex)
    .map((b) => (draft && draft.id === b.id ? { ...b, ...draft.rect } : b));

  const px = (r: Rect) => ({ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom });

  // While sweeping, highlight the words the drag will take.
  const sweeping = draft && draft.id === null && tool === "words" ? draft.rect : null;
  const pending = new Set(sweeping && words ? wordsInRect(words, sweeping) : []);

  // The action bubble stays out of the way while anything is being dragged.
  const selected = bubble && !draft && bubbleFor === selectedId ? shown.find((b) => b.id === selectedId) : undefined;
  /** What "Fit to words" would make of the selected box: one box per line, as a drag across them does. */
  const fitted = selected && tool === "words" && words ? lineRects(wordsInRect(words, selected)).map((l) => wordBox(l, size)) : [];
  const alreadyFits =
    selected &&
    fitted.length === 1 &&
    Math.abs(fitted[0]!.x - selected.x) < FIT_TOLERANCE &&
    Math.abs(fitted[0]!.y - selected.y) < FIT_TOLERANCE &&
    Math.abs(fitted[0]!.w - selected.w) < FIT_TOLERANCE &&
    Math.abs(fitted[0]!.h - selected.h) < FIT_TOLERANCE;

  const fitToWords = () => {
    if (!selected || !fitted.length) return;
    let next = updateBox(boxes, selected.id, fitted[0]!);
    for (const r of fitted.slice(1)) next = addBox(next, { id: newBoxId(), page: pageIndex, ...r });
    onChange(next);
  };

  return (
    <div className="page" style={{ width: size.width * zoom, height: size.height * zoom }}>
      <canvas ref={canvasRef} className="page-canvas" aria-hidden="true" />
      {rendering && <div className="page-loading">Rendering…</div>}
      <div
        ref={layerRef}
        className={`layer tool-${tool}${peek ? " peek" : ""}`}
        data-testid="page-layer"
        role="application"
        tabIndex={0}
        aria-label={`Page ${pageIndex + 1}`}
        aria-describedby="page-keys"
        onKeyDown={onLayerKey}
        onBlur={() => setAnnounce("")}
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
              className={`word${w === hover ? " hover" : ""}${pending.has(w) ? " pending" : ""}${w === cursor ? " cursor" : ""}`}
              data-testid="word"
              data-word={w.text}
              data-word-index={i}
              style={px(w)}
            />
          ))}
        {marks?.map((m) => (
          <div
            key={m.key}
            className={`finding-mark${m.active ? " active" : ""}`}
            data-testid="finding-mark"
            data-finding-id={m.id}
            style={px(m.rect)}
          />
        ))}
        {shown.map((b, i) => (
          <div
            key={b.id}
            className={`box${b.id === selectedId ? " selected" : ""}`}
            data-testid="box"
            data-box-id={b.id}
            style={px(b)}
            role="button"
            tabIndex={0}
            aria-label={`Redaction box ${i + 1}`}
            aria-describedby="box-keys"
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
      {selected && (
        <div
          className="box-bubble"
          data-testid="box-bubble"
          style={bubbleSpot({ x: selected.x * zoom, y: selected.y * zoom, w: selected.w * zoom, h: selected.h * zoom }, size.width * zoom, size.height * zoom)}
        >
          {fitted.length > 0 && !alreadyFits && (
            <button type="button" onClick={fitToWords}>
              Fit to words
            </button>
          )}
          <button type="button" className="danger" onClick={onDeleteSelected}>
            Delete box
          </button>
        </div>
      )}
      {finger && (
        <Loupe
          source={canvasRef}
          size={size}
          zoom={zoom}
          peek={peek}
          finger={finger}
          boxes={shown}
          active={draft && !sweeping ? draft.rect : null}
          highlights={sweeping ? [...pending] : []}
        />
      )}
      <p id="page-keys" className="sr-only">
        {tool === "words"
          ? "Click or tap a word, or drag across words, to black them out. With the keyboard: arrow keys move between words, Enter blacks out the current word."
          : "Drag to draw a redaction box. With the keyboard: press Enter to add a box in the middle of the view."}
      </p>
      <p id="box-keys" className="sr-only">
        Arrow keys move the box, Shift for bigger steps. Control or Command with arrow keys resizes it. Delete removes it.
      </p>
      <p className="sr-only" aria-live="polite" data-testid="page-announce">
        {announce}
      </p>
    </div>
  );
}
