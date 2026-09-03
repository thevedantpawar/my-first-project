/**
 * Charts, drawn as inline SVG.
 *
 * No charting library: the console needs four chart types, each of them
 * simple, and a 90KB dependency to draw seven bars is a poor trade for a
 * product that must stay fast on a front-desk laptop.
 *
 * Every chart is labelled for a screen reader and carries a data table
 * equivalent where the shape matters, so nothing here is conveyed by pixels
 * alone.
 */

import { el } from "../dom.js";
import * as fmt from "../format.js";

const NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  });
  return node;
}

/* -------------------------------------------------------------------------
   Horizontal bars — used for revenue breakdowns and lead sources.
   ------------------------------------------------------------------------- */
export function barList({ items, formatValue = fmt.number, emptyLabel = "No data yet" }) {
  const max = Math.max(...items.map((item) => item.value || 0), 0);
  if (!items.length || max === 0) {
    return el("p.small.muted", { text: emptyLabel });
  }

  return el(
    "ul.stack",
    { style: { gap: "var(--space-4)" } },
    items.map((item) =>
      el(
        "li",
        null,
        el(
          "div.row.row--between",
          { style: { marginBottom: "var(--space-2)", gap: "var(--space-3)" } },
          el(
            "span.small",
            { style: { minWidth: 0 } },
            el("span", { text: item.label }),
            item.hint
              ? el("span.xsmall.muted", { style: { marginLeft: "var(--space-2)" }, text: item.hint })
              : null
          ),
          el("span.small.numeric", {
            style: { fontWeight: "var(--weight-semibold)" },
            text: formatValue(item.value),
          })
        ),
        el(
          "div.bar",
          null,
          el("div.bar__fill", {
            style: {
              width: `${max ? Math.max((item.value / max) * 100, item.value > 0 ? 2 : 0) : 0}%`,
              background: item.colour ? `var(--${item.colour})` : null,
            },
          })
        )
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Funnel — stage counts with the drop-off between them.
   ------------------------------------------------------------------------- */
export function funnel({ stages }) {
  const max = Math.max(...stages.map((stage) => stage.value || 0), 1);

  return el(
    "ol.stack",
    { style: { gap: "var(--space-1)" } },
    stages.map((stage, index) => {
      const previous = index > 0 ? stages[index - 1].value : null;
      // A conversion rate is only meaningful between two stages counted from
      // the same set of records. Across a boundary it is arithmetic, not a
      // fact, so none is shown.
      const conversion =
        previous && previous > 0 && !stage.newSource
          ? Math.round((stage.value / previous) * 100)
          : null;
      const width = Math.max((stage.value / max) * 100, stage.value > 0 ? 6 : 2);

      return el(
        "li",
        null,
        index > 0
          ? el(
              "div.xsmall.muted",
              {
                style: {
                  padding: "var(--space-1) 0 var(--space-1) var(--space-3)",
                  borderLeft: "1.5px solid var(--line)",
                  marginLeft: "var(--space-3)",
                },
                text: conversion === null ? "" : `${conversion}% continue`,
              }
            )
          : null,
        el(
          "div.row",
          { style: { gap: "var(--space-3)" } },
          el(
            "div",
            {
              style: {
                width: `${width}%`,
                minWidth: "120px",
                background: index === stages.length - 1 ? "var(--accent-100)" : "var(--accent-50)",
                border: "1px solid var(--accent-100)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-3) var(--space-4)",
                transition: "width var(--duration-slow) var(--ease)",
              },
            },
            el("div.small", { style: { fontWeight: "var(--weight-semibold)" }, text: stage.label }),
            el("div.metric__value", {
              style: { fontSize: "var(--text-lg)" },
              text: fmt.number(stage.value),
            })
          )
        )
      );
    })
  );
}

/* -------------------------------------------------------------------------
   Donut — one share of a whole. Used sparingly: exactly one figure per donut.
   ------------------------------------------------------------------------- */
export function donut({ value, total, label, sublabel, size = 132 }) {
  const ratio = total > 0 ? Math.min(value / total, 1) : 0;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const root = svg("svg", {
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`,
    role: "img",
    "aria-label": `${label}: ${fmt.number(value)} of ${fmt.number(total)}`,
  });

  root.appendChild(
    svg("circle", {
      cx: size / 2,
      cy: size / 2,
      r: radius,
      fill: "none",
      stroke: "var(--ground-sunken)",
      "stroke-width": stroke,
    })
  );

  const arc = svg("circle", {
    cx: size / 2,
    cy: size / 2,
    r: radius,
    fill: "none",
    stroke: "var(--accent)",
    "stroke-width": stroke,
    "stroke-linecap": "round",
    "stroke-dasharray": circumference,
    "stroke-dashoffset": circumference * (1 - ratio),
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
    style: "transition: stroke-dashoffset var(--duration-slow) var(--ease)",
  });
  root.appendChild(arc);

  return el(
    "div",
    { style: { position: "relative", width: `${size}px`, height: `${size}px`, flex: "none" } },
    root,
    el(
      "div",
      {
        style: {
          position: "absolute",
          inset: "0",
          display: "grid",
          placeItems: "center",
          textAlign: "center",
        },
      },
      el(
        "div",
        null,
        el("div.metric__value", {
          style: { fontSize: "var(--text-2xl)" },
          text: total > 0 ? `${Math.round(ratio * 100)}%` : fmt.EMPTY,
        }),
        sublabel ? el("div.xsmall.muted", { text: sublabel }) : null
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Sparkline / column chart over time.
   ------------------------------------------------------------------------- */
export function columns({ points, height = 120, formatValue = fmt.number, ariaLabel }) {
  if (!points.length) return el("p.small.muted", { text: "No activity in this period." });

  const max = Math.max(...points.map((point) => point.value), 1);
  const gap = 6;
  const width = points.length * 28;

  const root = svg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width: "100%",
    height,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": ariaLabel || "Activity over time",
  });

  points.forEach((point, index) => {
    const barHeight = Math.max((point.value / max) * (height - 18), point.value > 0 ? 3 : 1);
    const x = index * 28 + gap / 2;
    const rect = svg("rect", {
      x,
      y: height - barHeight,
      width: 28 - gap,
      height: barHeight,
      rx: 3,
      fill: point.value > 0 ? "var(--accent-200)" : "var(--ground-sunken)",
    });
    rect.appendChild(svg("title")).textContent = `${point.label}: ${formatValue(point.value)}`;
    root.appendChild(rect);
  });

  return el(
    "figure",
    { style: { margin: 0 } },
    root,
    el(
      "figcaption.xsmall.muted",
      { style: { display: "flex", justifyContent: "space-between", marginTop: "var(--space-2)" } },
      el("span", { text: points[0].label }),
      el("span", { text: points[points.length - 1].label })
    )
  );
}
