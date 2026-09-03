/**
 * Component primitives.
 *
 * Every page composes these. If a page needs a new visual pattern it belongs
 * here first, so the twelfth screen looks like the first one.
 */

import { el, frag } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";

/* -------------------------------------------------------------------------
   Headers
   ------------------------------------------------------------------------- */
export function pageHeader({ eyebrow, title, subtitle, actions }) {
  return el(
    "header.page-header",
    null,
    el(
      "div.page-header__text",
      null,
      eyebrow && el("span.eyebrow", { text: eyebrow }),
      el("h1.page-title", { text: title }),
      subtitle && el("p.page-subtitle", { text: subtitle })
    ),
    actions && actions.length ? el("div.page-header__actions", null, actions) : null
  );
}

export function sectionHeader({ title, subtitle, actions, id }) {
  return el(
    "div.section-header",
    null,
    el(
      "div.section-header__text",
      null,
      el("h2.section-title", { text: title, id }),
      subtitle && el("p.small.muted", { text: subtitle })
    ),
    actions && actions.length ? el("div.row", null, actions) : null
  );
}

/* -------------------------------------------------------------------------
   Buttons
   ------------------------------------------------------------------------- */
export function button({
  label,
  variant = "secondary",
  size,
  iconName,
  trailingIcon,
  onClick,
  href,
  disabled,
  ariaLabel,
  block,
  // "button" by default so a button inside a form never submits it by
  // accident; pass "submit" for the one that is meant to.
  type = "button",
}) {
  const classes = ["btn", `btn--${variant}`];
  if (size) classes.push(`btn--${size}`);
  if (block) classes.push("btn--block");

  const children = [
    iconName ? icon(iconName, size === "sm" ? 14 : 16) : null,
    label ? el("span", { text: label }) : null,
    trailingIcon ? icon(trailingIcon, size === "sm" ? 14 : 16) : null,
  ];

  if (href) {
    return el("a", { class: classes.join(" "), href, "aria-label": ariaLabel }, children);
  }
  return el(
    "button",
    {
      class: classes.join(" "),
      type,
      onClick,
      disabled,
      "aria-label": ariaLabel,
    },
    children
  );
}

export function iconButton({ name, label, onClick, bordered, size = 18 }) {
  return el(
    "button",
    {
      class: `icon-btn${bordered ? " icon-btn--bordered" : ""}`,
      type: "button",
      onClick,
      "aria-label": label,
      title: label,
    },
    icon(name, size)
  );
}

/* -------------------------------------------------------------------------
   Badges
   ------------------------------------------------------------------------- */
export function badge(label, tone = "neutral", { dot = false } = {}) {
  return el(
    "span",
    { class: `badge badge--${tone}` },
    dot ? el("span.badge__dot") : null,
    el("span", { text: label })
  );
}

export function statusBadge(status) {
  return badge(fmt.statusLabel(status), fmt.statusTone(status), { dot: true });
}

/**
 * A live/simulated/not-connected marker.
 *
 * This is the console's most important honesty device: it is the only thing
 * standing between "your reminders are going out" and "your reminders are
 * being written to an audit log and thrown away".
 */
export function modeBadge(mode) {
  const map = {
    live: ["Live", "positive"],
    simulated: ["Simulation", "attention"],
    demo: ["Demo data", "attention"],
    not_connected: ["Not connected", "neutral"],
    estimated: ["Estimated", "info"],
    attributed: ["AI-influenced", "accent"],
    pending: ["Setup needed", "attention"],
    error: ["Needs attention", "critical"],
    unknown: ["Not observable", "neutral"],
  };
  const [label, tone] = map[mode] || map.unknown;
  return badge(label, tone, { dot: true });
}

export function avatar(name, { size = "", neutral = false } = {}) {
  const classes = ["avatar"];
  if (size) classes.push(`avatar--${size}`);
  if (neutral) classes.push("avatar--neutral");
  return el("span", { class: classes.join(" "), "aria-hidden": "true" }, fmt.initials(name));
}

/* -------------------------------------------------------------------------
   Cards and metrics
   ------------------------------------------------------------------------- */
export function card({ children, className = "", ...rest }) {
  return el("section", { class: `card ${className}`.trim(), ...rest }, children);
}

export function metricCard({ label, value, foot, tone, trend }) {
  return el(
    "div.card",
    null,
    el(
      "div.metric",
      null,
      el("span.metric__label", { text: label }),
      el(
        "div.row",
        { style: { gap: "var(--space-2)", alignItems: "baseline" } },
        el("span.metric__value", { text: value }),
        trend ? trendPill(trend) : null
      ),
      foot ? el("span.metric__foot", { text: foot }) : null,
      tone ? badge(tone.label, tone.tone) : null
    )
  );
}

function trendPill({ direction, label }) {
  const tone = direction === "up" ? "positive" : direction === "down" ? "critical" : "neutral";
  return el(
    "span",
    { class: `badge badge--${tone}` },
    icon(direction === "down" ? "arrowDown" : "arrowUp", 12),
    el("span", { text: label })
  );
}

/**
 * The one number a page is about. Used once per screen, never twice — its
 * whole job is to win the visual hierarchy.
 */
export function heroMetric({ eyebrow, value, label, note, side, empty = false }) {
  return el(
    "section.hero",
    null,
    el(
      "div.row.row--between.row--wrap",
      { style: { gap: "var(--space-6)", alignItems: "flex-start" } },
      el(
        "div.stack.stack--tight",
        null,
        eyebrow && el("span.eyebrow", { text: eyebrow }),
        el(empty ? "div.hero__value.hero__value--empty" : "div.hero__value.numeric", { text: value }),
        el("div.hero__label", { text: label }),
        note ? el("p.xsmall.muted", { style: { maxWidth: "44ch" }, text: note }) : null
      ),
      side || null
    )
  );
}

/* -------------------------------------------------------------------------
   States
   ------------------------------------------------------------------------- */
export function emptyState({ title, body, actions, iconName = "sparkle", tone = "" }) {
  return el(
    "div.state",
    null,
    el("div", { class: `state__icon${tone ? ` state__icon--${tone}` : ""}` }, icon(iconName, 22)),
    el("p.state__title", { text: title }),
    body ? el("p.state__body", { text: body }) : null,
    actions && actions.length ? el("div.state__actions", null, actions) : null
  );
}

export function errorState({ error, onRetry, context }) {
  const offline = error?.status === 0;
  const title = offline
    ? "Can't reach the Revenue Engine"
    : context || "Something went wrong loading this";
  const body = offline
    ? "The console reached the browser but not the server. This affects everything on the page — your data is not lost."
    : error?.message || "The server returned an unexpected response.";

  return el(
    "div.state",
    null,
    el("div.state__icon.state__icon--error", null, icon("alert", 22)),
    el("p.state__title", { text: title }),
    el("p.state__body", { text: body }),
    error?.requestId
      ? el("p.xsmall.muted", null, "Reference ", el("span.code", { text: error.requestId }))
      : null,
    el(
      "div.state__actions",
      null,
      onRetry ? button({ label: "Try again", variant: "primary", iconName: "refresh", onClick: onRetry }) : null
    )
  );
}

export function skeletonLines(count = 3) {
  return el(
    "div.stack.stack--tight",
    { "aria-hidden": "true" },
    Array.from({ length: count }, (_, index) =>
      el("div.skeleton", { style: { width: `${88 - index * 14}%` } })
    )
  );
}

export function skeletonCards(count = 4, { tall = false } = {}) {
  return el(
    "div",
    { class: `grid grid--${Math.min(count, 4)}`, "aria-hidden": "true" },
    Array.from({ length: count }, () =>
      el(
        "div.card",
        null,
        el("div.stack.stack--tight", null, el("div.skeleton", { style: { width: "45%" } }),
          el("div.skeleton.skeleton--metric"),
          tall ? el("div.skeleton", { style: { width: "70%" } }) : null)
      )
    )
  );
}

export function loadingRegion(label = "Loading") {
  const node = el(
    "div",
    { role: "status", "aria-live": "polite", class: "stack" },
    el("span.visually-hidden", { text: `${label}…` }),
    skeletonCards(4),
    el("div.card", null, skeletonLines(5))
  );
  return node;
}

/* -------------------------------------------------------------------------
   Tables
   ------------------------------------------------------------------------- */
/**
 * @param {object} config
 * @param {Array<{key:string,label:string,align?:string,width?:string,render:Function}>} config.columns
 * @param {Array<object>} config.rows
 * @param {Function} [config.onRowClick]
 * @param {string} [config.caption] - screen-reader description of the table
 */
export function dataTable({ columns, rows, onRowClick, rowKey, caption, empty }) {
  if (!rows.length && empty) return empty;

  const table = el(
    "table.table",
    null,
    caption ? el("caption.visually-hidden", { text: caption }) : null,
    el(
      "thead",
      null,
      el(
        "tr",
        null,
        columns.map((column) =>
          el("th", { scope: "col", style: column.width ? { width: column.width } : null }, column.label)
        )
      )
    ),
    el(
      "tbody",
      null,
      rows.map((row) => {
        const cells = columns.map((column) => el("td", null, column.render(row)));
        const attrs = {};
        if (onRowClick) {
          attrs.dataset = { clickable: "true" };
          attrs.tabindex = "0";
          attrs.role = "button";
          attrs["aria-label"] = rowKey ? `Open ${rowKey(row)}` : "Open details";
          attrs.onClick = () => onRowClick(row);
          attrs.onKeydown = (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onRowClick(row);
            }
          };
        }
        return el("tr", attrs, cells);
      })
    )
  );

  return el("div.table-wrap", null, table);
}

export function cellPerson(name, secondary) {
  return el(
    "div.cell-person",
    null,
    avatar(name, { size: "sm" }),
    el(
      "div",
      { style: { minWidth: 0 } },
      el("div.table__primary", { text: name }),
      secondary ? el("div.table__secondary", { text: secondary }) : null
    )
  );
}

/* -------------------------------------------------------------------------
   Filters and tabs
   ------------------------------------------------------------------------- */
export function filterBar({ options, active, onChange, counts }) {
  return el(
    "div.filter-bar",
    { role: "group", "aria-label": "Filter" },
    options.map((option) =>
      el(
        "button.chip",
        {
          type: "button",
          "aria-pressed": String(option.value === active),
          onClick: () => onChange(option.value),
        },
        el("span", { text: option.label }),
        counts && counts[option.value] !== undefined
          ? el("span.chip__count.numeric", { text: String(counts[option.value]) })
          : null
      )
    )
  );
}

export function tabs({ items, active, onChange, label = "Sections" }) {
  return el(
    "div.tabs",
    { role: "tablist", "aria-label": label },
    items.map((item) =>
      el("button.tab", {
        type: "button",
        role: "tab",
        "aria-selected": String(item.value === active),
        tabindex: item.value === active ? "0" : "-1",
        text: item.label,
        onClick: () => onChange(item.value),
        onKeydown: (event) => {
          const index = items.findIndex((candidate) => candidate.value === active);
          if (event.key === "ArrowRight") onChange(items[(index + 1) % items.length].value);
          if (event.key === "ArrowLeft") onChange(items[(index - 1 + items.length) % items.length].value);
        },
      })
    )
  );
}

/* -------------------------------------------------------------------------
   Timeline
   ------------------------------------------------------------------------- */
export function timeline(items) {
  return el(
    "ol.timeline",
    null,
    items.map((item) =>
      el(
        "li.timeline__item",
        { dataset: { pending: String(!item.done) } },
        el(
          "span",
          { class: `timeline__marker${item.done ? " timeline__marker--done" : ""}` },
          item.done ? icon("check", 12) : el("span.dot")
        ),
        el(
          "div.timeline__body",
          null,
          el("div.timeline__label", { text: item.label }),
          el(
            "div.timeline__meta",
            {
              text: item.at
                ? fmt.dateTime(item.at)
                : item.note || (item.done ? "" : "Not yet"),
            }
          )
        )
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Notes and disclosure
   ------------------------------------------------------------------------- */
export function note(text, variant = "") {
  const iconName = variant === "warn" ? "alert" : "info";
  return el(
    "p",
    { class: `note${variant ? ` note--${variant}` : ""}` },
    el("span.note__icon", null, icon(iconName, 14)),
    el("span", { text })
  );
}

/**
 * Progressive disclosure. Technical detail never disappears from this
 * product — it moves behind a summary the owner can ignore.
 */
export function disclosure(summary, body, { open = false } = {}) {
  return el(
    "details.disclosure",
    open ? { open: true } : null,
    el("summary", { text: summary }),
    el("div.disclosure__body", null, body)
  );
}

export function keyValues(pairs) {
  return el(
    "dl.kv",
    null,
    pairs.flatMap(([key, value]) => [
      el("dt", { text: key }),
      el("dd", null, value instanceof Node ? value : el("span", { text: String(value ?? fmt.EMPTY) })),
    ])
  );
}

export function progressBar(value, max, { tone } = {}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return el(
    "div.bar",
    { role: "img", "aria-label": `${Math.round(pct)} percent` },
    el("div.bar__fill", {
      style: { width: `${pct}%`, background: tone ? `var(--${tone})` : null },
    })
  );
}

export { el, frag, icon };
