import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPT, type LoadedDoc, LoadError, loadDocument } from "../core/load";
import { Editor } from "./Editor";
import { AUTHOR_NAME, AUTHOR_URL, LICENSE_URL, REPO_URL } from "./site";

export function App() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dirty = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const chooseFile = () => inputRef.current?.click();

  return (
    <div className={`app${dragging ? " is-dragging" : ""}`}>
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

      <PrivacyBanner />

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
          <Editor key={doc.name + doc.pages.length} doc={doc} onDirty={setDirty} />
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
      </footer>
    </div>
  );
}

function PrivacyBanner() {
  return (
    <details className="privacy" data-testid="privacy-banner">
      <summary>
        <strong>Your file never leaves this device.</strong> Everything runs in your browser. Nothing is uploaded or
        stored. <span className="link">How to verify</span>
      </summary>
      <div className="privacy-body">
        <ol>
          <li>
            After this page has loaded, turn off Wi-Fi or switch to airplane mode. Blackout keeps working, because it
            never needs the network.
          </li>
          <li>
            Or open your browser's developer tools (F12), go to the <em>Network</em> tab, then open and export a file.
            No request is made.
          </li>
          <li>
            The page's Content Security Policy sets <code>connect-src 'self'</code>, so the browser itself refuses to
            send data to any other server.
          </li>
          <li>
            The code is open source. You can read it, build it yourself and compare.
          </li>
        </ol>
      </div>
    </details>
  );
}
