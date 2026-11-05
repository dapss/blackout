// Small stroke icons for the phone toolbar (24px grid, drawn to match the app's line weight).
import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  draw: <rect x="4" y="7" width="16" height="10" rx="1" />,
  words: (
    <>
      <path d="M3 18 7.5 6h1L13 18" />
      <path d="M4.5 14h7" />
      <path d="M20 18v-5.5a2.5 2.5 0 0 0-5 0" />
      <path d="M20 15.5c-1-1-5-1.5-5 1 0 2 3.5 2 5 0" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  pages: (
    <>
      <rect x="7" y="3" width="13" height="16" rx="1.5" />
      <path d="M4 7v12.5A1.5 1.5 0 0 0 5.5 21H16" />
    </>
  ),
  back: <path d="m15 5-7 7 7 7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
