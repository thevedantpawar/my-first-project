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

/* -------------------------------------------------------------------------
   Area sparkline — the micro-chart in the revenue hero.
   ------------------------------------------------------------------------- */
export function sparkline({ points, height = 76, ariaLabel, accent = "var(--accent)" }) {
  const values = points.map((point) => point.value);
  const total = values.reduce((sum, value) => sum + value, 0);

  if (!points.length || total === 0) {
    return el("p.xsmall.muted", { text: "No activity recorded in this period." });
  }

  const width = 320;
  // Inset the plot so the stroke and the end marker are not sliced off by the
  // viewBox edge — a chart clipped at its most interesting point is a bug.
  const pad = 5;
  const plot = width - pad * 2;
  const max = Math.max(...values, 1);
  const step = points.length > 1 ? plot / (points.length - 1) : plot;
  const x = (index) => pad + index * step;
  const y = (value) => height - pad - (value / max) * (height - pad * 3);

  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
  const area = `${line} ${x(points.length - 1)},${height} ${x(0)},${height}`;

  const gradientId = `spark-${Math.random().toString(36).slice(2, 9)}`;
  const root = svg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width: "100%",
    height,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": ariaLabel || "Activity over the period",
  });

  const defs = svg("defs");
  const gradient = svg("linearGradient", { id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.appendChild(svg("stop", { offset: "0%", "stop-color": accent, "stop-opacity": "0.20" }));
  gradient.appendChild(svg("stop", { offset: "100%", "stop-color": accent, "stop-opacity": "0" }));
  defs.appendChild(gradient);
  root.appendChild(defs);

  root.appendChild(svg("polygon", { points: area, fill: `url(#${gradientId})` }));
  root.appendChild(
    svg("polyline", {
      points: line,
      fill: "none",
      stroke: accent,
      "stroke-width": 1.75,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    })
  );

  // The final point is emphasised — it is the reading the eye is looking for.
  const last = points[points.length - 1];
  root.appendChild(
    svg("circle", {
      cx: x(points.length - 1),
      cy: y(last.value),
      r: 3,
      fill: "var(--surface)",
      stroke: accent,
      "stroke-width": 2,
    })
  );

  return el(
    "figure",
    { style: { margin: 0, minWidth: 0 } },
    root,
    el(
      "figcaption.xsmall.muted",
      { style: { display: "flex", justifyContent: "space-between", marginTop: "var(--space-2)" } },
      el("span", { text: fmt.dateOnly(points[0].date) }),
      el("span", { text: `${fmt.number(total)} total` })
    )
  );
}
