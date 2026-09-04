/**
 * AI Team — the engine's modules, presented as colleagues rather than
 * services, with the technical configuration one disclosure away.
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
        // The lead agent gets the full width; the rest sit in a quieter grid.
        agents.length ? agentCard(agents[0], { feature: true }) : null,
        el("div.grid.grid--2", null, agents.slice(1).map((agent) => agentCard(agent))),
        note(
          "These are the parts of your engine, described in plain language. Open any one to see the model, the actions it can take, and the safety rules it runs under.",
          "neutral"
        )
      ),
    { skeleton: () => skeletonCards(4, { tall: true }), context: "Couldn't load your AI team" }
  );
}

/** The three-across strip used on the Overview. */
export function agentStrip(agents) {
  return el("div.grid.grid--3", null, agents.slice(0, 3).map((agent) => agentCard(agent, { compact: true })));
}

export function agentCard(agent, { compact = false, feature = false } = {}) {
  const metrics = compact ? agent.metrics.slice(0, 2) : agent.metrics;
  const live = agent.status !== "not_connected";

  return el(
    "article",
    {
      class: feature ? "card" : "card",
      style: {
        display: "flex",
        flexDirection: feature ? "row" : "column",
        gap: feature ? "var(--space-8)" : "var(--space-5)",
        alignItems: feature ? "center" : "stretch",
        flexWrap: feature ? "wrap" : "nowrap",
        padding: feature ? "var(--space-7)" : null,
      },
    },
    el(
      "div.stack",
      { style: { gap: "var(--space-4)", flex: feature ? "1 1 300px" : null, minWidth: 0 } },
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
                width: feature ? "44px" : "38px",
                height: feature ? "44px" : "38px",
                borderRadius: "var(--radius-md)",
                background: live ? "var(--accent-subtle)" : "var(--neutral-bg)",
                color: live ? "var(--accent)" : "var(--text-muted)",
                display: "grid",
                placeItems: "center",
                flex: "none",
              },
            },
            icon(AGENT_ICONS[agent.id] || "agents", feature ? 21 : 19)
          ),
          el(
            "div.stack",
            { style: { gap: "2px", minWidth: 0 } },
            el(feature ? "h3.section-title" : "h3.card-title", { text: agent.name }),
            el("p.small.muted", { text: agent.role })
          )
        ),
        statusBadgeFor(agent)
      ),
      compact ? null : el("p.small.secondary", { text: agent.description })
    ),

    el(
      "div",
      { style: { flex: feature ? "1 1 320px" : null, minWidth: 0 } },
      el(
        "div.grid",
        {
          style: {
            gridTemplateColumns: `repeat(${Math.min(metrics.length, 2)}, minmax(0, 1fr))`,
            gap: "var(--space-5)",
          },
        },
        metrics.map((metric) =>
          el(
            "div.stack",
            { style: { gap: "2px" } },
            el("span.metric__value", {
              style: { fontSize: feature ? "var(--text-2xl)" : "var(--text-xl)" },
              text: metric.unit === "%" ? fmt.percent(metric.value, { digits: 0 }) : fmt.number(metric.value),
            }),
            el("span.xsmall.muted", { text: metric.label })
          )
        )
      ),
      el(
        "div.row.row--between",
        {
          style: {
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: "var(--space-4)",
            marginTop: "var(--space-5)",
            gap: "var(--space-3)",
          },
        },
        el("span.xsmall.muted", { style: { minWidth: 0 }, text: agent.status_detail }),
        button({
          label: "View agent",
          variant: "ghost",
          size: "sm",
          trailingIcon: "arrowRight",
          onClick: () => openAgent(agent),
        })
      )
    )
  );
}

function statusBadgeFor(agent) {
  if (agent.status === "not_connected") return modeBadge("not_connected");
  return badge("Working", "positive", { dot: true });
}

/* -------------------------------------------------------------------------
   Agent detail — business view first, configuration behind a disclosure.
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
        el("p.small.secondary", { style: { marginTop: "var(--space-2)" }, text: agent.description }),
        el("p.xsmall.muted", { text: agent.status_detail })
      ),

      el(
        "section.stack",
        null,
        sectionHeader({ title: "Performance", ruled: true }),
        el(
          "div.grid.grid--2",
          null,
          agent.metrics.map((metric) =>
            el(
              "div.panel",
              null,
              el("div.metric__value", {
                style: { fontSize: "var(--text-xl)" },
                text: metric.unit === "%" ? fmt.percent(metric.value, { digits: 0 }) : fmt.number(metric.value),
              }),
              el("div.xsmall.muted", { style: { marginTop: "var(--space-2)" }, text: metric.label })
            )
          )
        )
      ),

      el(
        "section.stack",
        null,
        sectionHeader({ title: "Safety rules", ruled: true }),
        el(
          "ul.stack.stack--tight",
          null,
          agent.advanced.guardrails.map((rule) =>
            el(
              "li.row",
              { style: { gap: "var(--space-3)", alignItems: "flex-start" } },
              el("span", { style: { color: "var(--success)", marginTop: "2px" } }, icon("shield", 14)),
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
