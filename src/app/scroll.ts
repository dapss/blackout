import { useEffect, useState } from "react";

/** Scroll the nearest scrollable ancestors (the stage, then the page) by a pixel delta. */
export function scrollAncestorsBy(el: HTMLElement, dx: number, dy: number): void {
  for (let n = el.parentElement; n && (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5); n = n.parentElement) {
    const left = n.scrollLeft;
    const top = n.scrollTop;
    n.scrollBy({ left: dx, top: dy, behavior: "instant" });
    dx -= n.scrollLeft - left;
    dy -= n.scrollTop - top;
  }
}

/** Phone layout breakpoint, shared by the CSS (styles.css) and the components. */
export const PHONE_QUERY = "(max-width: 720px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
