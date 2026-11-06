// Accepted findings become ordinary boxes; nothing is blacked out without the user's say-so.
import { useCallback, useEffect, useRef, useState } from "react";
import { type Finding, findingsOnPage } from "../core/detect";
import type { LoadedDoc } from "../core/load";
import { PACKS } from "../packs";

export type FindingStatus = "pending" | "accepted" | "rejected";

export type Scan =
  | { state: "idle" }
  | { state: "scanning"; page: number; total: number }
  | { state: "done"; findings: Finding[]; noText: number[] };

/** Scans one page at a time, so a long document doesn't hold up the page. */
export function useDetection(doc: LoadedDoc): { scan: Scan; start: () => void } {
  const [scan, setScan] = useState<Scan>({ state: "idle" });
  const started = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const total = doc.pages.length;
      const findings: Finding[] = [];
      const noText: number[] = [];
      for (let page = 0; page < total; page++) {
        if (!live.current) return;
        setScan({ state: "scanning", page, total });
        await new Promise((r) => setTimeout(r));
        const words = await doc.words(page);
        if (!words.length) noText.push(page);
        findings.push(...findingsOnPage(words, page, doc.pages[page]!));
      }
      if (live.current) setScan({ state: "done", findings, noText });
    })();
  }, [doc]);

  return { scan, start };
}

/** "3", "3 and 5", "3, 5 and 9", or "3, 5, 9 and 4 more" (0-based pages, shown 1-based). */
function pageList(pages: number[]): string {
  const shown = pages.slice(0, 3).map((p) => String(p + 1));
  const rest = pages.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0]!;
}

const LOOKS_FOR = [...new Set(PACKS.flatMap((p) => p.detectors.map((d) => d.label)))].join(", ");

interface Props {
  scan: Scan;
  status: (f: Finding) => FindingStatus;
  totalPages: number;
  phone: boolean;
  focusedId: string | null;
  onShow: (f: Finding) => void;
  onAccept: (f: Finding) => void;
  onReject: (f: Finding) => void;
  onRestore: (f: Finding) => void;
  onAcceptAll: () => void;
  onUseDraw: (page: number) => void;
  onClose: () => void;
}

export function ReviewPanel({
  scan,
  status,
  totalPages,
  phone,
  focusedId,
  onShow,
  onAccept,
  onReject,
  onRestore,
  onAcceptAll,
  onUseDraw,
  onClose,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  // A phone has no room for the page and the list at once, so looking at one finding shrinks the panel to it.
  const [oneAtATime, setOneAtATime] = useState(false);

  const findings = scan.state === "done" ? scan.findings : [];
  const noText = scan.state === "done" ? scan.noText : [];
  const pending = findings.filter((f) => status(f) === "pending");
  const noTextAtAll = noText.length === totalPages;
  const count = `${findings.length} item${findings.length === 1 ? "" : "s"}`;
  const focusedAt = findings.findIndex((f) => f.id === focusedId);
  const single = phone && oneAtATime && focusedAt >= 0;
  const show = (f: Finding) => {
    if (phone) setOneAtATime(true);
    onShow(f);
  };

  return (
    <aside className="review" role="region" aria-label="Review findings" tabIndex={-1} ref={ref} data-testid="review-panel">
      {!single && (
        <div className="review-head">
          <h2>Find items</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}

      {single ? (
        <div className="review-step">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setOneAtATime(false);
              ref.current?.focus();
            }}
          >
            All items
          </button>
          <span data-testid="review-position">
            {focusedAt + 1} of {findings.length}
          </span>
          <button
            type="button"
            className="btn"
            disabled={findings.length < 2}
            onClick={() => show(findings[(focusedAt + 1) % findings.length]!)}
          >
            Next
          </button>
        </div>
      ) : scan.state !== "done" ? (
        <p role="status" data-testid="review-progress">
          {scan.state === "scanning" ? `Looking through page ${scan.page + 1} of ${scan.total}…` : "Starting…"}
        </p>
      ) : (
        <div role="status" data-testid="review-summary">
          {noTextAtAll ? (
            <p>This file has no selectable text, so detection can’t run on it yet.</p>
          ) : findings.length > 0 ? (
            <p>
              <strong>We found {count}.</strong> Please review the rest of the document too, because detection can miss
              things.
            </p>
          ) : (
            <p>
              <strong>We didn’t find anything.</strong> That doesn’t mean nothing is sensitive, so please review every
              page yourself.
            </p>
          )}
        </div>
      )}

      {!single && noText.length > 0 && (
        <p className="review-notext" data-testid="review-notext">
          {!noTextAtAll && (
            <>
              Detection can’t run yet on page{noText.length === 1 ? "" : "s"} {pageList(noText)}, which{" "}
              {noText.length === 1 ? "has" : "have"} no selectable text.{" "}
            </>
          )}
          Use Draw to cover things by hand.{" "}
          <button type="button" className="hint-action" onClick={() => onUseDraw(noText[0]!)}>
            Use Draw{noTextAtAll ? "" : ` on page ${noText[0]! + 1}`}
          </button>
        </p>
      )}

      {!single && findings.length > 0 && (
        <button type="button" className="btn primary review-all" disabled={pending.length === 0} onClick={onAcceptAll}>
          Redact all{pending.length > 0 ? ` (${pending.length})` : ""}
        </button>
      )}

      {!single && phone && findings.length > 0 && (
        <p className="review-note" data-testid="review-tap-hint">
          Tap an item to see it on the page.
        </p>
      )}

      {findings.length > 0 && (
        <ul className="review-list">
          {(single ? [findings[focusedAt]!] : findings).map((f) => {
            const s = status(f);
            return (
              <li
                key={f.id}
                className={`finding ${s}${f.id === focusedId ? " focused" : ""}`}
                data-testid="finding"
                data-detector={f.detectorId}
                data-status={s}
              >
                <button type="button" className="finding-show" onClick={() => show(f)} title="Show on the page">
                  <span className="finding-type">
                    {f.label} · Page {f.page + 1}
                  </span>
                  <span className="finding-text">{f.text}</span>
                </button>
                <div className="finding-actions">
                  {s === "pending" && (
                    <>
                      <button type="button" className="btn" onClick={() => onAccept(f)}>
                        Accept
                      </button>
                      <button type="button" className="btn" onClick={() => onReject(f)}>
                        Reject
                      </button>
                    </>
                  )}
                  {s === "accepted" && <span className="finding-state">Blacked out</span>}
                  {s === "rejected" && (
                    <>
                      <span className="finding-state">Rejected</span>
                      <button type="button" className="btn" onClick={() => onRestore(f)}>
                        Restore
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!single && (
        <p className="review-note">
          Looks for: {LOOKS_FOR}. Names, addresses and birth details are only found next to a label like Nama or
          Address. Signatures and photos aren’t detected, and anything else can be missed too.
        </p>
      )}
    </aside>
  );
}
