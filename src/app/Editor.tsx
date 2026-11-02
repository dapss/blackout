import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moveRect } from "../core/geometry";
import type { LoadedDoc } from "../core/load";
import type { Box } from "../core/types";
import { ExportDialog } from "./ExportDialog";
import { commit, type History, initHistory, redo, removeBox, removePageBoxes, undo, updateBox } from "./history";
import { PageView, type Tool } from "./PageView";
import { Thumbnails } from "./Thumbnails";

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export function Editor({ doc, onDirty }: { doc: LoadedDoc; onDirty: (dirty: boolean) => void }) {
  const [history, setHistory] = useState<History<Box[]>>(() => initHistory([]));
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");
  const [fitZoom, setFitZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("draw");
  const [peek, setPeek] = useState(false);
  const [wordCount, setWordCount] = useState<number | null>(null);
  const [touch] = useState(() => window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const [exporting, setExporting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

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

  // Fit the page to the available width.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth - 32;
      setFitZoom(Math.max(0.1, Math.min(2, avail / size.width)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.width]);

  const goTo = useCallback(
    (p: number) => {
      setPage(Math.max(0, Math.min(doc.pages.length - 1, p)));
      setSelectedId(null);
    },
    [doc.pages.length],
  );

  const stepZoom = (dir: 1 | -1) => {
    const next =
      dir > 0 ? ZOOM_STEPS.find((z) => z > zoom + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001);
    if (next) setZoomMode(next);
  };

  const doUndo = useCallback(() => setHistory(undo), []);
  const doRedo = useCallback(() => setHistory(redo), []);
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    change(removeBox(history.present, selectedId));
    setSelectedId(null);
  }, [selectedId, history.present, change]);

  // Keep the selection valid after undo/redo.
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
      } else if (selectedId && e.key.startsWith("Arrow")) {
        const box = boxes.find((b) => b.id === selectedId);
        if (!box) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        change(updateBox(boxes, box.id, moveRect(box, dx, dy, doc.pages[box.page]!)));
      } else if (!mod && e.key === "PageDown") {
        goTo(page + 1);
      } else if (!mod && e.key === "PageUp") {
        goTo(page - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exporting, selectedId, boxes, doc.pages, page, change, doUndo, doRedo, deleteSelected, goTo]);

  const multi = doc.pages.length > 1;

  return (
    <div className={`editor${multi ? " has-thumbs" : ""}`}>
      <div className="toolbar" role="toolbar" aria-label="Editing tools">
        <div className="group">
          <div className="segmented" role="radiogroup" aria-label="Tool">
            <button type="button" role="radio" aria-checked={tool === "draw"} onClick={() => setTool("draw")}>
              Draw
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={tool === "words"}
              onClick={() => setTool("words")}
              disabled={doc.kind !== "pdf"}
              title={
                doc.kind === "pdf"
                  ? "Click or drag across words to black them out"
                  : "Images have no text layer, so use Draw"
              }
            >
              Words
            </button>
          </div>
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
          <button
            type="button"
            className="btn"
            onClick={() => change(removePageBoxes(boxes, page))}
            disabled={!pageBoxes.length}
          >
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
            <button type="button" className="btn zoom-label" onClick={() => setZoomMode("fit")} title="Fit to width">
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

        <button type="button" className="btn primary" data-testid="export-button" onClick={() => setExporting(true)}>
          Export redacted {doc.kind === "pdf" ? "PDF" : "image"}
        </button>
      </div>

      {multi && <Thumbnails doc={doc} current={page} counts={counts} onSelect={goTo} />}

      <div className="stage" ref={stageRef}>
        <p className="hint stage-hint" data-testid="stage-hint">
          {touch && "Use two fingers to scroll. "}
          {tool === "words" && wordCount === 0
            ? "This page has no selectable text (it may be a scan). Use Draw to cover things by hand."
            : tool === "words" && boxes.length === 0
              ? "Click a word to black it out, or drag across several words."
              : boxes.length === 0
                ? "Drag across anything sensitive to black it out."
                : `${boxes.length} box${boxes.length === 1 ? "" : "es"} in total. Drag a box to move it, pull its handles to resize.`}
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
          onWordCount={setWordCount}
        />
      </div>

      {exporting && <ExportDialog doc={doc} boxes={boxes} onClose={() => setExporting(false)} />}
    </div>
  );
}
