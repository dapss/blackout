import { useEffect, useRef, useState } from "react";
import type { LoadedDoc } from "../core/load";
import { type ExportProgress, type ExportResult, exportSafe } from "../core/redact-safe";
import type { Box } from "../core/types";
import { summaryLine, type VerifyReport } from "../core/verify";
import { verifyInBrowser } from "../core/verify-browser";

type State =
  | { step: "rendering"; progress: ExportProgress | null }
  | { step: "verifying" }
  | { step: "done"; result: ExportResult; report: VerifyReport; url: string | null }
  | { step: "error"; message: string };

export function ExportDialog({ doc, boxes, onClose }: { doc: LoadedDoc; boxes: Box[]; onClose: () => void }) {
  const [state, setState] = useState<State>({ step: "rendering", progress: null });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    let url: string | null = null;
    (async () => {
      try {
        const result = await exportSafe(doc, boxes, {
          signal: ac.signal,
          onProgress: (progress) => setState({ step: "rendering", progress }),
        });
        if (ac.signal.aborted) return;
        setState({ step: "verifying" });
        const report = await verifyInBrowser(result, boxes);
        if (ac.signal.aborted) return;
        // The download only exists if every check passed.
        if (report.ok) url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: result.mime }));
        setState({ step: "done", result, report, url });
      } catch (err) {
        if (ac.signal.aborted) return;
        setState({ step: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      ac.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, boxes]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = state.step === "rendering" || state.step === "verifying";
  const pct =
    state.step === "rendering" && state.progress ? ((state.progress.page - 1) / state.progress.total) * 100 : busy ? 100 : 0;

  return (
    <div className="overlay">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        tabIndex={-1}
        ref={dialogRef}
        data-testid="export-dialog"
      >
        <h2 id="export-title">Export in safe mode</h2>
        <p className="muted">
          Each page is turned into an image, the boxes are burned in, and a brand-new file is built. The original's
          text, metadata, links, forms and attachments are left behind.
        </p>

        {busy && (
          <div className="progress-wrap" aria-live="polite">
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <p data-testid="export-status">
              {state.step === "verifying"
                ? "Checking the output…"
                : state.progress
                  ? `Flattening page ${state.progress.page} of ${state.progress.total}…`
                  : "Starting…"}
            </p>
          </div>
        )}

        {state.step === "error" && (
          <p className="alert" role="alert">
            Export failed: {state.message}
          </p>
        )}

        {state.step === "done" && (
          <>
            <p className={`verdict ${state.report.ok ? "ok" : "fail"}`} data-testid="verify-summary" role="status">
              {summaryLine(state.report)}
            </p>
            {boxes.length === 0 && (
              <p className="muted">
                You haven't drawn any boxes, so nothing is blacked out. The file is still flattened and cleaned.
              </p>
            )}
            <ul className="checks" data-testid="verify-checks">
              {state.report.checks.map((c) => (
                <li key={c.id} className={c.ok ? "ok" : "fail"} data-check={c.id} data-ok={c.ok}>
                  <span className="mark" aria-hidden="true">
                    {c.ok ? "✓" : "✕"}
                  </span>
                  <span>
                    {c.label}
                    {c.detail && <small>{c.detail}</small>}
                  </span>
                  <span className="sr-only">{c.ok ? "passed" : "failed"}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {busy ? "Cancel" : "Back to editing"}
          </button>
          {state.step === "done" && state.url && (
            <a className="btn primary" href={state.url} download={state.result.fileName} data-testid="download">
              Export
            </a>
          )}
          {state.step === "done" && !state.url && (
            <button type="button" className="btn primary" disabled data-testid="download-blocked">
              Download blocked
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
