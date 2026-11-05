import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPT, type LoadedDoc, LoadError, loadDocument } from "../core/load";
import { Editor } from "./Editor";
import { PrivacyBanner } from "./Privacy";
import { PHONE_QUERY, useMediaQuery } from "./scroll";
import {
  APP_COMMIT,
  APP_RELEASED,
  APP_VERSION,
  AUTHOR_NAME,
  AUTHOR_URL,
  COMMIT_URL,
  LICENSE_URL,
  LIVE_URL,
  REPO_URL,
  VERIFY_URL,
} from "./site";

export function App() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dirty = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  // On a phone the open document gets the whole screen; the editor draws its own bars.
  const phoneEditing = !!doc && phone;
  const setDirty = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  const open = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (dirty.current && !window.confirm("Open a new file? Your boxes on the current one will be lost.")) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadDocument(file);
      setDoc((prev) => {
        prev?.destroy();
        return next;
      });
      dirty.current = false;
    } catch (err) {
      setError(err instanceof LoadError ? err.message : "Something went wrong while opening this file.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void open(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [open]);

  // Boxes live only in memory: warn before a reload or closed tab throws them away.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      e.preventDefault();
      e.returnValue = ""; // still needed by some browsers to show the prompt
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  // Match the phone browser's bar to the page, or to the top bar once a file is open.
  useEffect(() => {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = (phoneEditing ? meta.dataset.editing : meta.dataset.page) ?? meta.content;
    }
  }, [phoneEditing]);

  const chooseFile = () => inputRef.current?.click();

  const close = useCallback(() => {
    if (dirty.current && !window.confirm("Close this file? Your boxes will be lost.")) return;
    dirty.current = false;
    setDoc((prev) => {
      prev?.destroy();
      return null;
    });
  }, []);

  return (
    <div className={`app${dragging ? " is-dragging" : ""}${phoneEditing ? " phone-editing" : ""}`}>
      {!phoneEditing && (
      <header className="topbar">
        <a className="brand" href="./" aria-label="Blackout home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Blackout
        </a>
        {doc && (
          <button type="button" className="btn ghost" onClick={chooseFile}>
            Open another file
          </button>
        )}
      </header>
      )}

      {!phoneEditing && <PrivacyBanner />}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="file-input"
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <main className="main">
        {doc ? (
          <Editor
            key={doc.name + doc.pages.length}
            doc={doc}
            phone={phone}
            onDirty={setDirty}
            onOpenFile={chooseFile}
            onClose={close}
          />
        ) : (
          <section className="dropzone" aria-busy={loading}>
            <h1>Redact documents without uploading them</h1>
            <p className="lede">
              Black out names, numbers and signatures in a PDF or photo. The file is processed on this device and
              the result is checked before you download it.
            </p>
            <button type="button" className="btn primary large" onClick={chooseFile} disabled={loading}>
              {loading ? "Opening…" : "Choose a file"}
            </button>
            <p className="hint">or drop it anywhere on this page · PDF, PNG, JPEG, WebP</p>
          </section>
        )}
      </main>

      {!phoneEditing && (
      <footer className="footer">
        <span>
          Made by{" "}
          <a href={AUTHOR_URL} rel="noopener noreferrer" target="_blank">
            {AUTHOR_NAME}
          </a>
        </span>
        <a href={REPO_URL} rel="noopener noreferrer" target="_blank">
          Source on GitHub
        </a>
        <a href={LICENSE_URL} rel="noopener noreferrer" target="_blank">
          Apache-2.0 license
        </a>
        <span data-testid="build-version">
          <a href={COMMIT_URL} rel="noopener noreferrer" target="_blank" title="The exact source code of this build">
            v{APP_VERSION}
            {APP_COMMIT && ` · ${APP_COMMIT.slice(0, 7)}`}
          </a>{" "}
          (
          <a href={VERIFY_URL} rel="noopener noreferrer" target="_blank">
            verify
          </a>
          )
        </span>
        {!APP_RELEASED && (
          <a
            className="preview-tag"
            data-testid="preview-label"
            href={LIVE_URL}
            title={`Unreleased changes newer than v${APP_VERSION}. Open the released version.`}
          >
            Preview build
          </a>
        )}
      </footer>
      )}
    </div>
  );
}
