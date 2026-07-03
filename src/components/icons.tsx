// Inline SVG icons, 16x16 grid, 1.5px strokes — the whole icon "font".
import type { JSX } from "solid-js";

const base = (path: JSX.Element, viewBox = "0 0 16 16") => (
  <svg
    width="16"
    height="16"
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {path}
  </svg>
);

export const IconBack = () => base(<path d="M10.5 3.5 6 8l4.5 4.5" />);
export const IconForward = () => base(<path d="M5.5 3.5 10 8l-4.5 4.5" />);
export const IconReload = () =>
  base(
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" />
      <path d="M13.5 1.8v2.8h-2.8" />
    </>
  );
export const IconStop = () => base(<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />);
export const IconClose = () =>
  base(<path d="M5 5l6 6M11 5l-6 6" stroke-width="1.3" />);
export const IconPlus = () => base(<path d="M8 3.5v9M3.5 8h9" />);
export const IconEllipsis = () =>
  base(
    <>
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </>
  );
export const IconLock = () =>
  base(
    <>
      <rect x="3.5" y="7" width="9" height="6" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </>
  );
export const IconGlobe = () =>
  base(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c-3.5 3.4-3.5 7.6 0 11M8 2.5c3.5 3.4 3.5 7.6 0 11" />
    </>
  );
export const IconSearch = () =>
  base(
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 13.5 13.5" />
    </>
  );
export const IconSpeaker = () =>
  base(
    <>
      <path d="M3 6.2v3.6h2.2L8.5 12V4L5.2 6.2H3z" fill="currentColor" stroke="none" />
      <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12 4a5.5 5.5 0 0 1 0 8" />
    </>
  );
export const IconSpeakerMuted = () =>
  base(
    <>
      <path d="M3 6.2v3.6h2.2L8.5 12V4L5.2 6.2H3z" fill="currentColor" stroke="none" />
      <path d="M10.5 6l4 4M14.5 6l-4 4" />
    </>
  );
export const IconMoon = () =>
  base(<path d="M12.8 9.6A5.3 5.3 0 0 1 6.4 3.2a5.3 5.3 0 1 0 6.4 6.4z" fill="currentColor" stroke="none" />);
export const IconChevronUp = () => base(<path d="M4 10l4-4 4 4" />);
export const IconChevronDown = () => base(<path d="M4 6l4 4 4-4" />);
export const IconMinimize = () => base(<path d="M3.5 8h9" />);
export const IconMaximize = () => base(<rect x="4" y="4" width="8" height="8" rx="1" />);
