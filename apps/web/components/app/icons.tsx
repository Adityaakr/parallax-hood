/* 20px line icons for the dashboard shell (1.5px strokes, like the template's sidebar). */
import type { SVGProps } from "react";
const I = ({ children, ...p }: SVGProps<SVGSVGElement>) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>{children}</svg>
);
export const Ic = {
  search: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></I>,
  spark: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></I>,
  send: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M21 3L10 14" /><path d="M21 3l-7 18-4-7-7-4z" /></I>,
  download: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M4 20h16" /></I>,
  plus: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></I>,
  home: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></I>,
  chart: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M4 20h16" /><path d="M6 16l4-5 3 3 5-7" /></I>,
  trend: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></I>,
  file: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h6" /></I>,
  layers: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></I>,
  link: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></I>,
  pie: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 3v9h9" /><circle cx="12" cy="12" r="9" /></I>,
  target: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></I>,
  swap: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M7 4v16M7 20l-3-3M7 20l3-3" /><path d="M17 20V4M17 4l-3 3M17 4l3 3" /></I>,
  up: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 20V6" /><path d="M6 12l6-6 6 6" /></I>,
  down: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 4v14" /><path d="M6 12l6 6 6-6" /></I>,
  clock: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>,
  gear: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></I>,
  palette: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="12" r="9" /><circle cx="8.5" cy="10" r="1" /><circle cx="12" cy="7.5" r="1" /><circle cx="15.5" cy="10" r="1" /><path d="M12 21c-1.5 0-2-1-2-2s.5-2 2-2h2a3 3 0 003-3" /></I>,
  shield: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></I>,
  bell: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M6 16V11a6 6 0 0112 0v5l2 2H4z" /><path d="M10 21h4" /></I>,
  share: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 15V4" /><path d="M8 8l4-4 4 4" /><path d="M5 13v7h14v-7" /></I>,
  flag: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></I>,
  chevron: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M6 9l6 6 6-6" /></I>,
  chevrons: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M8 9l4-4 4 4" /><path d="M8 15l4 4 4-4" /></I>,
  more: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></I>,
  dots: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></I>,
  info: (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></I>,
  check: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M5 12l4 4L19 7" /></I>,
  wallet: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M3 7.5A2.5 2.5 0 015.5 5H17a2 2 0 012 2v1" /><path d="M3 7.5V17a2 2 0 002 2h14a2 2 0 002-2V10a2 2 0 00-2-2H5.5A2.5 2.5 0 013 7.5z" /><path d="M16.5 13.5h.5" /></I>,
  x: (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>,
};
