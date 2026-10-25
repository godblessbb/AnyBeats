/* 图标：和 design/mockups/shared.js 里的一模一样（内联 SVG，不外链）。 */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icon = {
  play: () => (
    <svg viewBox="0 0 16 16">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  ),
  pause: () => (
    <svg viewBox="0 0 16 16">
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  ),
  start: () => (
    <svg viewBox="0 0 16 16">
      <rect x="3" y="3" width="2" height="10" rx="1" fill="currentColor" />
      <path d="M13 3v10L6 8z" fill="currentColor" />
    </svg>
  ),
  rec: () => (
    <svg viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5" fill="currentColor" />
    </svg>
  ),
  undo: () => (
    <svg viewBox="0 0 16 16" {...stroke}>
      <path d="M5 4 2 7l3 3" />
      <path d="M2.5 7H10a4 4 0 0 1 0 8H7" />
    </svg>
  ),
  redo: () => (
    <svg viewBox="0 0 16 16" {...stroke}>
      <path d="m11 4 3 3-3 3" />
      <path d="M13.5 7H6a4 4 0 0 0 0 8h3" />
    </svg>
  ),
  metro: () => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M6 2h4l3 12H3z" />
      <path d="M8 11 11.5 4" />
    </svg>
  ),
  guide: () => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 10v-4M5 12V4M8 13V3M11 11V5M14 9V7" />
    </svg>
  ),
  loop: () => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9V7a3 3 0 0 1 3-3h7" />
      <path d="m11 2 2 2-2 2" />
      <path d="M13 7v2a3 3 0 0 1-3 3H3" />
      <path d="m5 14-2-2 2-2" />
    </svg>
  ),
  out: () => (
    <svg viewBox="0 0 16 16" {...stroke}>
      <path d="M8 2v8" />
      <path d="m5 7 3 3 3-3" />
      <path d="M3 11v2h10v-2" />
    </svg>
  ),
  pen: () => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="m3 15 1-4 8-8 3 3-8 8z" />
    </svg>
  ),
  rhyme: () => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 5h8M3 9h6M3 13h8" />
      <circle cx="14" cy="5" r="1.6" fill="currentColor" />
      <circle cx="14" cy="13" r="1.6" fill="currentColor" />
    </svg>
  ),
  ai: () => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="3" y="4" width="12" height="10" rx="3" />
      <path d="M7 8v2M11 8v2" />
    </svg>
  ),
  mic: () => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="6.5" y="2" width="5" height="9" rx="2.5" />
      <path d="M4 9a5 5 0 0 0 10 0M9 14v2" />
    </svg>
  ),
  proj: () => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M2.5 5.5a1 1 0 0 1 1-1h4l1.5 2h5.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    </svg>
  ),
  minus: () => (
    <svg viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 8h8" />
    </svg>
  ),
  plus: () => (
    <svg viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 8h8M8 4v8" />
    </svg>
  ),
  more: () => (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <circle cx="4" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12" cy="8" r="1.3" />
    </svg>
  ),
  close: () => (
    <svg viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  ),
  warn: () => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M8 2 1.5 13.5h13z" />
      <path d="M8 6.5v3.5M8 12v.01" strokeLinecap="round" />
    </svg>
  ),
  info: () => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7v4.5M8 4.8v.01" />
    </svg>
  ),
};
