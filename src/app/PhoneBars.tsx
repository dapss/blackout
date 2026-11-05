// Phone layout chrome: a slim top bar, the page in between, and a toolbar within thumb reach.
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { LoadedDoc } from "../core/load";
import { useDialogFocus } from "./focus";
import { Icon } from "./icons";
import type { Tool } from "./PageView";
import { PrivacySteps } from "./Privacy";
import { Thumbnails } from "./Thumbnails";

/** A panel that slides up from the bottom of the screen. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface TopProps {
  doc: LoadedDoc;
  page: number;
  counts: number[];
  zoomMode: "fit" | number;
  zoom: number;
  peek: boolean;
  canClearPage: boolean;
  onClose: () => void;
  onExport: () => void;
  onGoTo: (page: number) => void;
  onZoom: (z: "in" | "out" | "fit") => void;
  onPeek: (on: boolean) => void;
  onClearPage: () => void;
  onAddBox: () => void;
  onOpenFile: () => void;
}

export function PhoneTopBar(p: TopProps) {
  const [menu, setMenu] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const total = p.doc.pages.length;

  const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)") ?? [])];

  // Opening the menu moves focus to its first item, as a menu button should.
  useEffect(() => {
    if (menu) menuItems()[0]?.focus();
  }, [menu]);

  const closeMenu = (refocus: boolean) => {
    setMenu(false);
    if (refocus) moreRef.current?.focus();
  };

  /** Arrow keys move between items, Home/End jump, Escape closes, Tab leaves the menu. */
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = menuItems();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === "Tab") closeMenu(false);
  };

  // Close the menu on any tap outside it.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menu]);

  const item = (label: string, action: () => void, opts: { disabled?: boolean; checked?: boolean } = {}) => (
    <button
      type="button"
      role={opts.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={opts.checked}
      disabled={opts.disabled}
      tabIndex={-1}
      onClick={() => {
        closeMenu(true);
        action();
      }}
    >
      {label}
      {opts.checked && <span aria-hidden="true">✓</span>}
    </button>
  );

  return (
    <>
      <header className="p-top">
        <button type="button" className="p-icon" onClick={p.onClose} aria-label="Close file">
          <Icon name="back" />
        </button>
        <span className="p-name" title={p.doc.name}>
          {p.doc.name}
        </span>
        <div className="p-menu-wrap" ref={menuRef}>
          <button
            type="button"
            ref={moreRef}
            className="p-icon"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <Icon name="more" />
          </button>
          {menu && (
            <div className="p-menu" role="menu" aria-label="More" onKeyDown={onMenuKey}>
              {item("Add box", p.onAddBox)}
              {item("Zoom in", () => p.onZoom("in"))}
              {item("Zoom out", () => p.onZoom("out"))}
              {item(p.zoomMode === "fit" ? "Fit to width" : `Fit to width (now ${Math.round(p.zoom * 100)}%)`, () =>
                p.onZoom("fit"),
              )}
              {item("Peek under boxes", () => p.onPeek(!p.peek), { checked: p.peek })}
              {item("Clear page", p.onClearPage, { disabled: !p.canClearPage })}
              {item("Open another file", p.onOpenFile)}
            </div>
          )}
        </div>
        <button type="button" className="p-export" data-testid="export-button" onClick={p.onExport}>
          Export
        </button>
      </header>

      <div className="p-info">
        <button type="button" className="p-private" onClick={() => setPrivacy(true)} data-testid="private-chip">
          <Icon name="lock" size={14} />
          Private
        </button>
        {total > 1 && (
          <span className="p-pager">
            <button
              type="button"
              className="p-icon small"
              onClick={() => p.onGoTo(p.page - 1)}
              disabled={p.page === 0}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span data-testid="page-indicator">
              {p.page + 1} / {total}
            </span>
            <button
              type="button"
              className="p-icon small"
              onClick={() => p.onGoTo(p.page + 1)}
              disabled={p.page === total - 1}
              aria-label="Next page"
            >
              ›
            </button>
          </span>
        )}
      </div>

      {privacy && (
        <Sheet title="Your file never leaves this device" onClose={() => setPrivacy(false)}>
          <p className="sheet-lede">Everything runs in your browser. Nothing is uploaded or stored. To check:</p>
          <div className="privacy-body">
            <PrivacySteps />
          </div>
        </Sheet>
      )}
    </>
  );
}

interface BottomProps {
  doc: LoadedDoc;
  tool: Tool;
  wordsTitle: string;
  canUndo: boolean;
  canRedo: boolean;
  page: number;
  counts: number[];
  onTool: (t: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onGoTo: (page: number) => void;
}

export function PhoneBottomBar(p: BottomProps) {
  const [pages, setPages] = useState(false);
  const multi = p.doc.pages.length > 1;
  return (
    <>
      <nav className="p-bottom" aria-label="Editing tools">
        <div role="radiogroup" aria-label="Tool" className="p-tools">
          <button type="button" role="radio" aria-checked={p.tool === "draw"} onClick={() => p.onTool("draw")}>
            <Icon name="draw" />
            Draw
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={p.tool === "words"}
            onClick={() => p.onTool("words")}
            disabled={p.doc.kind !== "pdf"}
            title={p.wordsTitle}
          >
            <Icon name="words" />
            Words
          </button>
        </div>
        <button type="button" onClick={p.onUndo} disabled={!p.canUndo}>
          <Icon name="undo" />
          Undo
        </button>
        <button type="button" onClick={p.onRedo} disabled={!p.canRedo}>
          <Icon name="redo" />
          Redo
        </button>
        {multi && (
          <button type="button" onClick={() => setPages(true)}>
            <Icon name="pages" />
            Pages
          </button>
        )}
      </nav>

      {pages && (
        <Sheet title="Pages" onClose={() => setPages(false)}>
          <Thumbnails
            doc={p.doc}
            current={p.page}
            counts={p.counts}
            layout="grid"
            onSelect={(i) => {
              p.onGoTo(i);
              setPages(false);
            }}
          />
        </Sheet>
      )}
    </>
  );
}
