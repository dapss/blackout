/**
 * Single source of truth for the Content-Security-Policy.
 * Used by the Vite plugin (meta tag + preview header + `_headers` for static hosts)
 * and by the tests.
 */
export interface CspOptions {
  /** Vite dev server needs inline scripts for React Fast Refresh. */
  dev?: boolean;
  /** Directives that only work as an HTTP header, not in a <meta> tag. */
  header?: boolean;
}

export function buildCsp({ dev = false, header = false }: CspOptions = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'", "data:"],
    // The whole point of the app: the page can only talk to its own origin.
    "connect-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
  };
  if (header) directives["frame-ancestors"] = ["'none'"];
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}
