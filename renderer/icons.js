'use strict';

// Hand-drawn SVG icons and ornaments (original artwork for this app).
// Line icons use currentColor; ornaments are drawn in the theme's teal.

const S = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const F = (body) => `<svg viewBox="0 0 24 24" fill="currentColor">${body}</svg>`;

const ICONS = {
  // modules
  combat: S('<path d="M4 4l9 9M4 4v3M4 4h3"/><path d="M20 4l-9 9M20 4v3M20 4h-3"/><path d="M8 15l-3 3M16 15l3 3M6.5 19.5l-2-2M17.5 19.5l2-2"/>'),
  session: S('<path d="M4 20h16"/><rect x="5.5" y="12" width="3" height="6" rx=".6"/><rect x="10.5" y="7" width="3" height="11" rx=".6"/><rect x="15.5" y="4" width="3" height="14" rx=".6"/>'),
  challenges: S('<circle cx="11" cy="13" r="7"/><circle cx="11" cy="13" r="3.5"/><path d="M11 13l8-8M16 5h3v3"/>'),
  honour: S('<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.6M17 6h2.5a2.5 2.5 0 0 1-2.6 3.6"/><path d="M12 14v3M8.5 20h7M9.5 17h5"/>'),

  // header buttons
  lock: S('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  clipboard: S('<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V4h6v1M9 11h6M9 15h4"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  stack: S('<rect x="4" y="5" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="15" width="16" height="4" rx="1"/>'),
  columns: S('<rect x="4" y="5" width="4" height="14" rx="1"/><rect x="10" y="5" width="4" height="14" rx="1"/><rect x="16" y="5" width="4" height="14" rx="1"/>'),
  contrast: S('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  reset: S('<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4v4h4"/>'),
  help: S('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 16.8v.2"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),

  // rows
  hourglass: S('<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>'),
  sparkle: S('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  coin: S('<ellipse cx="12" cy="8" rx="7" ry="3"/><path d="M5 8v4c0 1.7 3.1 3 7 3s7-1.3 7-3V8"/><path d="M5 12v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>'),
  bag: S('<path d="M6 9h12l-1 11H7L6 9z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/>'),
  target: S('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>'),
  burst: S('<path d="M12 2l2 6 6-3-3 6 6 2-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-2-3-6 6 3z"/>'),
  bolt: S('<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>'),
  heart: S('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  wall: S('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4M15 5v0"/>'),
  shield: S('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>'),
  skull: S('<path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4 2.5 5v3h9v-3c1.3-1 2.5-2.5 2.5-5a7 7 0 0 0-7-7z"/><circle cx="9.3" cy="11" r="1.4"/><circle cx="14.7" cy="11" r="1.4"/><path d="M10.5 18v2M13.5 18v2"/>'),
  flag: S('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),

  // spell elements (filled, coloured by CSS)
  feu: F('<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3-1-5 1-8z"/>'),
  eau: F('<path d="M12 2c3 5 7 8.5 7 12.5a7 7 0 0 1-14 0C5 10.5 9 7 12 2z"/>'),
  terre: F('<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19l7-7" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>'),
  air: S('<path d="M3 8h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h7"/>'),
  'lumière': F('<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4M4.6 4.6l2.8 2.8M16.6 16.6l2.8 2.8M4.6 19.4l2.8-2.8M16.6 7.4l2.8-2.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  neutre: S('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>'),
  stasis: S('<path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/><path d="M12 7l4.3 2.5v5L12 17l-4.3-2.5v-5z"/>'),
};

// Decorative corner curl (bottom corners).
const CURL = `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
<path d="M2 38c0-14 6-24 20-26 8-1 12 6 7 10-4 3-9 0-7-3"/><path d="M2 38c8-1 13-5 15-10" opacity=".7"/></svg>`;

// Header scenery: hills, a windmill and trees, as a soft silhouette.
const SCENERY = `<svg viewBox="0 0 200 40" preserveAspectRatio="xMaxYMax meet" fill="currentColor">
<path d="M0 40c20-10 40-14 60-10s30 2 45-6 35-10 55-2 30 8 40 6v12z" opacity=".55"/>
<path d="M118 40V22l3-2 3 2v18z"/><path d="M121 20l-9-6M121 20l9-7M121 20l-6 9M121 20l7 8" stroke="currentColor" stroke-width="1.6"/>
<circle cx="150" cy="26" r="5"/><rect x="149" y="28" width="2" height="12"/>
<circle cx="160" cy="29" r="3.6"/><rect x="159.2" y="30" width="1.6" height="10"/>
<path d="M88 40V30l4-4 4 4v10z"/><path d="M86 31l6-6 6 6z"/></svg>`;

function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ico ${cls}`.trim();
  span.innerHTML = ICONS[name] || '';
  return span;
}
