import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Finding, isCovered } from "../core/detect";
import { moveRect, resizeRect } from "../core/geometry";
import type { LoadedDoc } from "../core/load";
import type { Box } from "../core/types";
import { ExportDialog } from "./ExportDialog";
import { addBox, commit, type History, initHistory, newBoxId, redo, removeBox, removePageBoxes, undo, updateBox } from "./history";
import { PageView, type Tool } from "./PageView";
import { PhoneBottomBar, PhoneTopBar } from "./PhoneBars";
import { scrollAncestorsBy } from "./scroll";
import { type FindingStatus, ReviewPanel, useDetection } from "./ReviewPanel";
import { Thumbnails } from "./Thumbnails";

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;

/** The tip about the two modes shows until dismissed, once per visit. Not saved: the app stores nothing. */
let tipDismissed = false;

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

interface Props {
  doc: LoadedDoc;
  phone: boolean;
  onDirty: (dirty: boolean) => void;
  onOpenFile: () => void;
  onClose: () => void;
}

export function Editor({ doc, phone, onDirty, onOpenFile, onClose }: Props) {
  const [history, setHistory] = useState<History<Box[]>>(() => initHistory([]));
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");
  const [fitZoom, setFitZoom] = useState(1);
  // Start in Words where there's text to select. Images have none, and a scan turns out to have none
  // once its words have been looked for, which moves it to Draw unless the user has already chosen.
  const [tool, setTool] = useState<Tool>(doc.kind === "pdf" ? "words" : "draw");
  const autoTool = useRef(doc.kind === "pdf");
  const [tip, setTip] = useState(doc.kind === "pdf" && !tipDismissed);
  const [gestured, setGestured] = useState(false);
  const [peek, setPeek] = useState(false);
  const [wordCount, setWordCount] = useState<number | null>(null);
  const [touch] = useState(() => window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const [exporting, setExporting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  const { scan, start: startScan } = useDetection(doc);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set());
  /** A new object each time, so showing the same finding again scrolls back to it. */
  const [focused, setFocused] = useState<{ id: string } | null>(null);

  const boxes = history.present;
  const size = doc.pages[page]!;
  const zoom = zoomMode === "fit" ? fitZoom : zoomMode;
  const pageBoxes = useMemo(() => boxes.filter((b) => b.page === page), [boxes, page]);
  const counts = useMemo(() => {
    const c = new Array<number>(doc.pages.length).fill(0);
    for (const b of boxes) c[b.page]! += 1;
    return c;
  }, [boxes, doc.pages.length]);

  useEffect(() => {
    onDirty(boxes.length > 0);
  }, [boxes.length, onDirty]);

  const change = useCallback((next: Box[]) => setHistory((h) => commit(h, next)), []);

  const chooseTool = useCallback((t: Tool) => {
    autoTool.current = false;
    setTool(t);
  }, []);

  const onWordCount = useCallback((count: number | null) => {
    setWordCount(count);
    if (count === null || !autoTool.current) return;
    autoTool.current = false;
    if (count === 0) {
      setTool("draw");
      setTip(false);
    }
  }, []);

  const dismissTip = useCallback(() => {
    tipDismissed = true;
    setTip(false);
  }, []);

  useEffect(() => {
    if (boxes.length > 0) dismissTip();
    if (boxes.length > 0 || zoomMode !== "fit") setGestured(true);
  }, [boxes.length, zoomMode, dismissTip]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth - (phone ? 16 : 32);
      setFitZoom(Math.max(0.1, Math.min(2, avail / size.width)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.width, phone]);

  const layer = () => stageRef.current?.querySelector<HTMLElement>("[data-testid='page-layer']") ?? null;

  const zoomTo = useCallback(
    (target: number | "fit", cx?: number, cy?: number) => {
      const el = layer();
      const stage = stageRef.current;
      if (el && stage) {
        const r = el.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        const x = cx ?? (Math.max(r.left, s.left) + Math.min(r.right, s.right)) / 2;
        const y = cy ?? (Math.max(r.top, s.top) + Math.min(r.bottom, s.bottom)) / 2;
        zoomAnchor.current = { px: (x - r.left) / zoom, py: (y - r.top) / zoom, cx: x, cy: y };
      }
      if (target === "fit") setZoomMode("fit");
      else setZoomMode(Math.max(Math.min(0.25, fitZoom), Math.min(MAX_ZOOM, target)));
    },
    [zoom, fitZoom],
  );

  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    zoomAnchor.current = null;
    const el = layer();
    if (!a || !el) return;
    const r = el.getBoundingClientRect();
    scrollAncestorsBy(el, r.left + a.px * zoom - a.cx, r.top + a.py * zoom - a.cy);
  }, [zoom]);

  const onDoubleTap = useCallback(
    (cx: number, cy: number) => {
      if (zoom > fitZoom * 1.2) zoomTo("fit", cx, cy);
      else zoomTo(fitZoom * DOUBLE_TAP_ZOOM, cx, cy);
    },
    [zoom, fitZoom, zoomTo],
  );

  const goTo = useCallback(
    (p: number) => {
      setPage(Math.max(0, Math.min(doc.pages.length - 1, p)));
      setSelectedId(null);
    },
    [doc.pages.length],
  );

  // Each step changes the size by at least ~15%, even from an in-between zoom like Fit.
  const stepZoom = (dir: 1 | -1) => {
    const next =
      dir > 0 ? ZOOM_STEPS.find((z) => z > zoom * 1.15) : [...ZOOM_STEPS].reverse().find((z) => z < zoom / 1.15);
    if (next) zoomTo(next);
  };

  const doUndo = useCallback(() => setHistory(undo), []);
  const doRedo = useCallback(() => setHistory(redo), []);
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    change(removeBox(history.present, selectedId));
    setSelectedId(null);
  }, [selectedId, history.present, change]);
  const clearPage = () => change(removePageBoxes(boxes, page));

  const [focusBox, setFocusBox] = useState<string | null>(null);
  useEffect(() => {
    if (!focusBox) return;
    stageRef.current?.querySelector<HTMLElement>(`[data-box-id="${focusBox}"]`)?.focus();
    setFocusBox(null);
  }, [focusBox]);

  const addBoxInView = useCallback(() => {
    const el = layer();
    const stage = stageRef.current;
    let cx = size.width / 2;
    let cy = size.height / 2;
    if (el && stage) {
      const r = el.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      const top = Math.max(r.top, s.top, 0);
      const bottom = Math.min(r.bottom, s.bottom, window.innerHeight);
      if (bottom > top) {
        cx = ((Math.max(r.left, s.left) + Math.min(r.right, s.right)) / 2 - r.left) / zoom;
        cy = ((top + bottom) / 2 - r.top) / zoom;
      }
    }
    const w = size.width * 0.3;
    const h = Math.max(12, size.height * 0.025);
    const box: Box = {
      id: newBoxId(),
      page,
      x: Math.min(Math.max(0, cx - w / 2), size.width - w),
      y: Math.min(Math.max(0, cy - h / 2), size.height - h),
      w,
      h,
    };
    change(addBox(boxes, box));
    setSelectedId(box.id);
    setFocusBox(box.id);
  }, [size, zoom, page, boxes, change]);

  useEffect(() => {
    if (selectedId && !boxes.some((b) => b.id === selectedId)) setSelectedId(null);
  }, [boxes, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exporting || isTyping(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        doRedo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setSelectedId(null);
        dismissTip();
      } else if (selectedId && e.key.startsWith("Arrow")) {
        const box = boxes.find((b) => b.id === selectedId);
        if (!box) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const pageSize = doc.pages[box.page]!;
        // Arrows move; Ctrl/Cmd + arrows resize from the bottom-right corner (Alt+arrow is the browser's Back).
        const next = mod ? resizeRect(box, "se", dx, dy, pageSize) : moveRect(box, dx, dy, pageSize);
        change(updateBox(boxes, box.id, next));
      } else if (!mod && e.key === "PageDown") {
        goTo(page + 1);
      } else if (!mod && e.key === "PageUp") {
        goTo(page - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exporting, selectedId, boxes, doc.pages, page, change, doUndo, doRedo, deleteSelected, goTo, dismissTip]);

  // A finding counts as blacked out only while a box really covers it, so undoing, moving or deleting
  // that box puts it back up for review.
  const findings = scan.state === "done" ? scan.findings : [];
  const status = (f: Finding): FindingStatus =>
    isCovered(f, boxes) ? "accepted" : rejected.has(f.id) ? "rejected" : "pending";
  const unreviewed = findings.filter((f) => status(f) === "pending").length;

  const blackOut = (list: Finding[]) => {
    let next = boxes;
    for (const f of list) for (const r of f.rects) next = addBox(next, { id: newBoxId(), page: f.page, ...r });
    change(next);
  };

  const openReview = () => {
    dismissTip();
    setReviewOpen(true);
    startScan();
  };

  const closeReview = () => {
    setReviewOpen(false);
    setFocused(null);
    stageRef.current?.closest(".editor")?.querySelector<HTMLElement>("[data-testid='find-button']")?.focus();
  };

  const review = reviewOpen && (
    <ReviewPanel
      scan={scan}
      status={status}
      totalPages={doc.pages.length}
      phone={phone}
      focusedId={focused?.id ?? null}
      onShow={(f) => {
        goTo(f.page);
        setFocused({ id: f.id });
      }}
      onAccept={(f) => blackOut([f])}
      onReject={(f) => setRejected((r) => new Set(r).add(f.id))}
      onRestore={(f) =>
        setRejected((r) => {
          const next = new Set(r);
          next.delete(f.id);
          return next;
        })
      }
      onAcceptAll={() => blackOut(findings.filter((f) => status(f) === "pending"))}
      onUseDraw={(p) => {
        chooseTool("draw");
        goTo(p);
      }}
      onClose={closeReview}
    />
  );

  const marks = reviewOpen
    ? findings
        .filter((f) => f.page === page && (status(f) === "pending" || f.id === focused?.id))
        .flatMap((f) => f.rects.map((rect, i) => ({ key: `${f.id}-${i}`, id: f.id, rect, active: f.id === focused?.id })))
    : [];

  const multi = doc.pages.length > 1;
  const wordsTitle =
    doc.kind === "pdf" ? "Click or drag across words to black them out" : "Images have no text layer, so use Draw";

  const noText = tool === "words" && wordCount === 0;
  const hint =
    tool === "words" && wordCount === null
      ? "Finding the words on this page…"
      : noText
      ? "This page has no selectable text, so Words and Find can’t run here yet."
      : tool === "words" && boxes.length === 0
        ? phone
          ? "Tap a word to black it out, or drag across several words."
          : "Click a word to black it out, or drag across several words."
        : boxes.length === 0
          ? "Drag across anything sensitive to black it out."
          : phone
            ? `${boxes.length} box${boxes.length === 1 ? "" : "es"}. Tap a box for options, drag to move it.`
            : `${boxes.length} box${boxes.length === 1 ? "" : "es"} in total. Drag a box to move it, pull its handles to resize.`;

  const stage = (
    <div className="stage" ref={stageRef}>
      <p className="hint stage-hint" data-testid="stage-hint">
        {touch && !gestured && !noText && "Pinch to zoom, two fingers to scroll. "}
        {hint}
        {noText && (
          <button type="button" className="hint-action" onClick={() => chooseTool("draw")}>
            Use Draw
          </button>
        )}
      </p>
      <PageView
        doc={doc}
        pageIndex={page}
        zoom={zoom}
        tool={tool}
        peek={peek}
        boxes={boxes}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChange={change}
        onWordCount={onWordCount}
        onPinchZoom={zoomTo}
        onDoubleTap={onDoubleTap}
        onAddBox={addBoxInView}
        onTwoFingers={() => setGestured(true)}
        marks={marks}
        focusMark={focused}
        bubble={phone}
        onDeleteSelected={deleteSelected}
      />
    </div>
  );

  const tipCard = tip && (
    <div className="tip" role="status" data-testid="mode-tip">
      <strong>Two ways to black things out</strong>
      <p>
        <b>Words:</b> {phone ? "tap" : "click"} a word, or drag along a line of text.
      </p>
      <p>
        <b>Draw:</b> drag a box over anything, including signatures and photos.
      </p>
      <p>Or use Find to look for emails, phone numbers and ID numbers.</p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          dismissTip();
          layer()?.focus({ preventScroll: true });
        }}
      >
        Got it
      </button>
    </div>
  );

  const dialog = exporting && <ExportDialog doc={doc} boxes={boxes} unreviewed={unreviewed} onClose={() => setExporting(false)} />;

  if (phone) {
    return (
      <div className="editor phone">
        <PhoneTopBar
          doc={doc}
          page={page}
          counts={counts}
          zoomMode={zoomMode}
          zoom={zoom}
          peek={peek}
          canClearPage={pageBoxes.length > 0}
          onClose={onClose}
          onExport={() => setExporting(true)}
          onGoTo={goTo}
          onZoom={(z) => (z === "in" ? stepZoom(1) : z === "out" ? stepZoom(-1) : zoomTo("fit"))}
          onPeek={setPeek}
          onClearPage={clearPage}
          onAddBox={addBoxInView}
          onOpenFile={onOpenFile}
        />
        {stage}
        {tipCard}
        {review}
        <PhoneBottomBar
          doc={doc}
          tool={tool}
          wordsTitle={wordsTitle}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          page={page}
          counts={counts}
          onTool={chooseTool}
          onFind={openReview}
          onUndo={doUndo}
          onRedo={doRedo}
          onGoTo={goTo}
        />
        {dialog}
      </div>
    );
  }

  return (
    <div className={`editor${multi ? " has-thumbs" : ""}${reviewOpen ? " has-review" : ""}`}>
      <div className="toolbar" role="toolbar" aria-label="Editing tools">
        <div className="group tool-group">
          <div className="segmented" role="radiogroup" aria-label="Tool">
            <button type="button" role="radio" aria-checked={tool === "draw"} onClick={() => chooseTool("draw")}>
              Draw
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={tool === "words"}
              onClick={() => chooseTool("words")}
              disabled={doc.kind !== "pdf"}
              title={wordsTitle}
            >
              Words
            </button>
          </div>
          {tipCard}
          <button
            type="button"
            className="btn"
            onClick={addBoxInView}
            title="Adds a box in the middle of the view. Arrow keys move it, Ctrl or Command with arrow keys resizes it."
          >
            Add box
          </button>
          <button
            type="button"
            className="btn"
            data-testid="find-button"
            onClick={openReview}
            title="Look for emails, phone numbers, card numbers and ID numbers"
          >
            Find items
          </button>
          <button type="button" className="btn" onClick={doUndo} disabled={!history.past.length} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button
            type="button"
            className="btn"
            onClick={doRedo}
            disabled={!history.future.length}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
          <button type="button" className="btn" onClick={deleteSelected} disabled={!selectedId} title="Delete (Del)">
            Delete
          </button>
          <button type="button" className="btn" onClick={clearPage} disabled={!pageBoxes.length}>
            Clear page
          </button>
        </div>

        <div className="group">
          {multi && (
            <span className="pager">
              <button type="button" className="btn icon" onClick={() => goTo(page - 1)} disabled={page === 0} aria-label="Previous page">
                ‹
              </button>
              <span data-testid="page-indicator">
                {page + 1} / {doc.pages.length}
              </span>
              <button
                type="button"
                className="btn icon"
                onClick={() => goTo(page + 1)}
                disabled={page === doc.pages.length - 1}
                aria-label="Next page"
              >
                ›
              </button>
            </span>
          )}
          <span className="zoom">
            <button type="button" className="btn icon" onClick={() => stepZoom(-1)} aria-label="Zoom out">
              −
            </button>
            <button type="button" className="btn zoom-label" onClick={() => zoomTo("fit")} title="Fit to width">
              {zoomMode === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
            </button>
            <button type="button" className="btn icon" onClick={() => stepZoom(1)} aria-label="Zoom in">
              +
            </button>
          </span>
          <label className="check">
            <input type="checkbox" checked={peek} onChange={(e) => setPeek(e.target.checked)} />
            Peek under boxes
          </label>
        </div>

        <button
          type="button"
          className="btn primary"
          data-testid="export-button"
          onClick={() => setExporting(true)}
          title={`Export a redacted copy of this ${doc.kind === "pdf" ? "PDF" : "image"}`}
        >
          Export
        </button>
      </div>

      {multi && <Thumbnails doc={doc} current={page} counts={counts} onSelect={goTo} />}

      {stage}
      {review}
      {dialog}
    </div>
  );
}
