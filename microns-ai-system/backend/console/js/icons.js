/**
 * Icon set — a single consistent family (24px grid, 1.75 stroke, round caps).
 * Inlined as SVG strings so the console makes no third-party requests.
 */

const wrap = (paths, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  overview: (s) => wrap('<path d="M3 12l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>', s),
  opportunity: (s) => wrap('<path d="M12 2v4"/><path d="M12 18v4"/><circle cx="12" cy="12" r="6"/><path d="m9.5 12 1.8 1.8 3.2-3.4"/>', s),
  inbox: (s) => wrap('<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>', s),
  leads: (s) => wrap('<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M18 8v6"/><path d="M21 11h-6"/>', s),
  calendar: (s) => wrap('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/>', s),
  revenue: (s) => wrap('<path d="M4 19V5"/><path d="M4 19h16"/><path d="m8 15 3.5-4.5L15 14l4-6"/>', s),
  tasks: (s) => wrap('<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5"/><path d="m3.5 12 1.2 1.2L7 11"/><path d="m3.5 18 1.2 1.2L7 17"/>', s),
  agents: (s) => wrap('<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4"/><circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none"/><path d="M2 12v3M22 12v3"/>', s),
  workflow: (s) => wrap('<rect x="3" y="3" width="7" height="6" rx="2"/><rect x="14" y="15" width="7" height="6" rx="2"/><path d="M6.5 9v5a4 4 0 0 0 4 4h3.5"/>', s),
  insights: (s) => wrap('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 1 3.6 10.8c-.6.5-.9 1-1 1.7H9.4c-.1-.7-.4-1.2-1-1.7A6 6 0 0 1 12 3z"/>', s),
  lab: (s) => wrap('<path d="M9 3h6"/><path d="M10 3v6.2L4.9 18a2 2 0 0 0 1.7 3h10.8a2 2 0 0 0 1.7-3L14 9.2V3"/><path d="M7.5 15h9"/>', s),
  settings: (s) => wrap('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 8.7 1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 2.6"/>', s),
  plug: (s) => wrap('<path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8z"/><path d="M12 17v5"/>', s),
  phone: (s) => wrap('<path d="M5 3h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 12l5 2v4a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 5.2 2 2 0 0 1 5 3z"/>', s),
  message: (s) => wrap('<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>', s),
  search: (s) => wrap('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', s),
  refresh: (s) => wrap('<path d="M20 11a8 8 0 0 0-13.6-4.6L3 9"/><path d="M4 13a8 8 0 0 0 13.6 4.6L21 15"/><path d="M3 5v4h4"/><path d="M21 19v-4h-4"/>', s),
  arrowRight: (s) => wrap('<path d="M5 12h13"/><path d="m12 5 7 7-7 7"/>', s),
  arrowUp: (s) => wrap('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', s),
  arrowDown: (s) => wrap('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', s),
  check: (s) => wrap('<path d="m4 12 5.5 5.5L20 7"/>', s),
  checkCircle: (s) => wrap('<circle cx="12" cy="12" r="9"/><path d="m8 12 2.8 2.8L16 9.5"/>', s),
  alert: (s) => wrap('<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', s),
  info: (s) => wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>', s),
  clock: (s) => wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', s),
  sparkle: (s) => wrap('<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4z"/>', s),
  user: (s) => wrap('<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>', s),
  close: (s) => wrap('<path d="M6 6 18 18"/><path d="M18 6 6 18"/>', s),
  menu: (s) => wrap('<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>', s),
  logout: (s) => wrap('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>', s),
  lock: (s) => wrap('<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', s),
  shield: (s) => wrap('<path d="M12 3 5 6v6c0 4.4 2.9 7.9 7 9 4.1-1.1 7-4.6 7-9V6l-7-3z"/>', s),
  play: (s) => wrap('<path d="M8 5.5v13l10-6.5-10-6.5z"/>', s),
  inboxEmpty: (s) => wrap('<path d="M4 6h16v12H4z"/><path d="M4 12h4l1.5 2h5L16 12h4"/>', s),
  star: (s) => wrap('<path d="m12 4 2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8L12 4z"/>', s),
  bell: (s) => wrap('<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6z"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>', s),
  // The Microns mark: a measured aperture — three strokes narrowing to a
  // point, for a product that measures and closes gaps.
  micronsMark: (s) => wrap('<path d="M4 6.5h16"/><path d="M7 12h10"/><path d="M10.5 17.5h3"/>', s),
  building: (s) => wrap('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01"/>', s),
};

/** Returns an <svg> element for `name`. */
export function icon(name, size = 18) {
  const factory = icons[name];
  const span = document.createElement("span");
  span.className = "icon";
  span.style.display = "inline-flex";
  span.innerHTML = factory ? factory(size) : icons.info(size);
  return span.firstChild;
}
