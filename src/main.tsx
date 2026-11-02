import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { startPdfWorker } from "./core/pdfjs";
import { warmExportWorker } from "./core/redact-safe";
import "./app/styles.css";

// Fetch every worker script now, during the initial load. After this the app makes no requests.
startPdfWorker();
warmExportWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
