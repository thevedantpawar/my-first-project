/**
 * AI Team — the engine's modules, presented as colleagues rather than
 * services, with the technical configuration one click away.
 */

import { el } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { load } from "../store.js";
import {
  badge,
  button,
  keyValues,
  modeBadge,
  note,
  pageHeader,
  sectionHeader,
  skeletonCards,
} from "../ui/components.js";
import { openDrawer } from "../ui/overlays.js";
import { renderAsync } from "./common.js";

const AGENT_ICONS = {
  receptionist: "phone",
  concierge: "message",
  recovery: "refresh",
  reactivation: "sparkle",
  reviews: "star",
};

export async function renderTeam(container) {
  const body = el("div");

  container.replaceChildren(
    pageHeader({
      eyebrow: "Your AI team",
      title: "The team working for you",
      subtitle: "Five specialists, working behind the scenes around the clock.",
    }),
    body
  );

  return renderAsync(
    body,
    () => load.agents(),
    (agents) =>
      el(
        "div.stack.stack--loose",
        null,
        el("div.grid.grid--2", null, agents.map((agent) => agentCard(agent))),
        note(
          "These are the parts of your engine, described in plain language. Open any one of them to see exactly which model, tools and safety rules it runs with.",
          "neutral"
        )
      ),
    { skeleton: () => skeletonCards(4, { tall: true }), context: "Couldn't load your AI team" }
  );
}

/** Also used on the Overview page, so the two never diverge. */
export function agentCard(agent, { compact = false } = {}) {
  const metrics = compact ? agent.metrics.slice(0, 2) : agent.metrics;

  return el(
    "article.card",
    { style: { display: "flex", flexDirection: "column", gap: "var(--space-5)" } },
    el(
      "div.row.row--between",
      { style: { alignItems: "flex-start", gap: "var(--space-3)" } },
      el(
        "div.row",
        { style: { gap: "var(--space-3)", minWidth: 0 } },
        el(
          "span",
          {
            style: {
              width: "38px",
              height: "38px",
              borderRadius: "var(--radius-md)",
              background: "var(--accent-50)",
              color: "var(--accent)",
              display: "grid",
              placeItems: "center",
              flex: "none",
            },
          },
          icon(AGENT_ICONS[agent.id] || "agents", 19)
        ),
        el(
          "div.stack",
          { style: { gap: "2px", minWidth: 0 } },
          el("h3.card-title", { text: agent.name }),
          el("p.small.muted", { text: agent.role })
        )
      ),
      statusBadgeFor(agent)
    ),
    compact ? null : el("p.small.secondary", { text: agent.description }),
    el(
      "div.grid",
      { style: { gridTemplateColumns: `repeat(${Math.min(metrics.length, 2)}, minmax(0, 1fr))`, gap: "var(--space-4)" } },
      metrics.map((metric) =>
        el(
          "div.stack",
          { style: { gap: "2px" } },
          el("span.metric__value", {
            style: { fontSize: "var(--text-xl)" },
            text: metric.unit === "%" ? fmt.percent(metric.value, { digits: 0 }) : fmt.number(metric.value),
          }),
          el("span.xsmall.muted", { text: metric.label })
        )
      )
    ),
    el(
      "div",
      {
        style: {
          borderTop: "1px solid var(--line-faint)",
          paddingTop: "var(--space-4)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--space-3)",
        },
      },
      el("span.xsmall.muted", { style: { minWidth: 0 }, text: agent.status_detail }),
      button({
        label: "View",
        variant: "ghost",
        size: "sm",
        trailingIcon: "arrowRight",
        onClick: () => openAgent(agent),
      })
    )
  );
}

function statusBadgeFor(agent) {
  if (agent.status === "not_connected") return modeBadge("not_connected");
  return badge("Working", "positive", { dot: true });
}

/* -------------------------------------------------------------------------
   Agent detail — business view first, technical configuration behind a
   disclosure. Nothing is removed, only re-ordered.
   ------------------------------------------------------------------------- */
function openAgent(agent) {
  openDrawer({
    title: agent.name,
    subtitle: agent.role,
    body: el(
      "div.stack.stack--loose",
      null,
      el(
        "div.stack.stack--tight",
        null,
        statusBadgeFor(agent),
        el("p.small.secondary", { text: agent.description }),
        el("p.xsmall.muted", { text: agent.status_detail })
      ),

      el(
        "section.stack",
        null,
        sectionHeader({ title: "Performance" }),
        el(
          "div.grid.grid--2",
          null,
          agent.metrics.map((metric) =>
            el(
              "div.card.card--quiet",
              null,
              el("div.metric__value", {
                style: { fontSize: "var(--text-xl)" },
                text: metric.unit === "%" ? fmt.percent(metric.value, { digits: 0 }) : fmt.number(metric.value),
              }),
              el("div.xsmall.muted", { text: metric.label })
            )
          )
        )
      ),

      el(
        "section.stack",
        null,
        sectionHeader({ title: "Safety rules" }),
        el(
          "ul.stack.stack--tight",
          null,
          agent.advanced.guardrails.map((rule) =>
            el(
              "li.row",
              { style: { gap: "var(--space-2)", alignItems: "flex-start" } },
              el("span", { style: { color: "var(--positive)", marginTop: "2px" } }, icon("shield", 14)),
              el("span.small", { text: rule })
            )
          )
        )
      ),

      el(
        "details.disclosure",
        null,
        el("summary", { text: "Advanced configuration" }),
        el(
          "div.disclosure__body.stack",
          null,
          keyValues([
            ["AI model", el("span.code", { text: agent.advanced.model })],
            ["Implemented in", el("span.code", { text: agent.advanced.module })],
          ]),
          el(
            "div.stack.stack--tight",
            null,
            el("p.eyebrow", { text: "Actions it can take" }),
            el(
              "div.row.row--wrap",
              { style: { gap: "var(--space-2)" } },
              agent.advanced.tools.map((tool) => el("span.code", { text: tool }))
            )
          ),
          note(
            "Prompts, models and tool definitions are configured in the deployment, not from this console. Changing them here would put clinical safety rules behind a web form.",
            "neutral"
          )
        )
      )
    ),
  });
}
