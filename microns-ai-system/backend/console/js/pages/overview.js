/**
 * Overview — the page a med spa owner opens in the morning.
 *
 * Hierarchy, in order: what needs you, what you earned, what your team did.
 * Not a grid of equal cards.
 */

import { el } from "../dom.js";
import * as fmt from "../format.js";
import { load, state } from "../store.js";
import {
  button,
  card,
  heroMetric,
  metricCard,
  note,
  pageHeader,
  sectionHeader,
  skeletonCards,
} from "../ui/components.js";
import { donut } from "../ui/charts.js";
import { renderAsync, opportunityCard, runOpportunityAction, emptyOpportunities } from "./common.js";
import { openOpportunity } from "./opportunities.js";
import { agentCard } from "./team.js";

export async function renderOverview(container) {
  const clinic = state.system?.clinic?.name || "your clinic";

  const attentionSlot = el("section", { "aria-labelledby": "attention-heading" });
  const metricSlot = el("section");
  const teamSlot = el("section", { "aria-labelledby": "team-heading" });

  container.replaceChildren(
    pageHeader({
      eyebrow: fmt.greeting(),
      title: headline(clinic),
      subtitle: `Here's what your AI Revenue Engine handled in the last ${state.windowDays} days.`,
      actions: [
        button({
          label: "Open opportunities",
          variant: "secondary",
          iconName: "opportunity",
          href: "#/opportunities",
        }),
        button({
          label: "Revenue",
          variant: "primary",
          trailingIcon: "arrowRight",
          href: "#/revenue",
        }),
      ],
    }),
    metricSlot,
    el("div.section", null, attentionSlot),
    el("div.section", null, teamSlot)
  );

  renderMetrics(metricSlot);
  renderAttention(attentionSlot);
  renderTeam(teamSlot);
}

function headline(clinic) {
  return clinic === "your clinic" ? "Your revenue engine" : clinic;
}

/* -------------------------------------------------------------------------
   Headline metrics
   ------------------------------------------------------------------------- */
function renderMetrics(target) {
  return renderAsync(
    target,
    () => Promise.all([load.overview(), load.revenue()]),
    ([overview, revenue]) => {
      const completed = revenue.completed;
      const hasRevenue = completed.priced_count > 0;
      const engine = overview.engine;

      const hero = heroMetric({
        eyebrow: `AI-influenced revenue · last ${revenue.window_days} days`,
        value: hasRevenue ? fmt.money(completed.cents) : fmt.EMPTY,
        label: hasRevenue
          ? `From ${fmt.pluralise(completed.priced_count, "completed appointment")} with a recorded price`
          : "No appointment prices recorded yet",
        note: hasRevenue
          ? `${fmt.number(completed.count - completed.priced_count)} further completed appointments carry no price, so they are not counted here.`
          : "Your engine tracks bookings and recovery today. Record a price on an appointment and it will appear here.",
        side: el(
          "div.row",
          { style: { gap: "var(--space-6)", alignItems: "center" } },
          el(
            "div.stack.stack--tight",
            { style: { textAlign: "right" } },
            el("span.eyebrow", { text: "Recovered" }),
            el("span.metric__value", { text: fmt.number(revenue.recovered_appointments) }),
            el("span.xsmall.muted", { text: "appointments won back" })
          ),
          donut({
            value: overview.bookings.ai_assisted,
            total: overview.bookings.created || 1,
            label: "Share of bookings your AI created",
            sublabel: "AI booked",
          })
        ),
      });

      return el(
        "div.stack.stack--loose",
        null,
        hero,
        el(
          "div.grid.grid--4",
          null,
          metricCard({
            label: "New leads",
            value: fmt.number(overview.leads.total),
            foot: `${fmt.number(overview.leads.hot)} high intent · ${fmt.number(overview.leads.warm)} medium`,
          }),
          metricCard({
            label: "Appointments booked",
            value: fmt.number(overview.bookings.created),
            foot: `${fmt.number(overview.bookings.today)} scheduled today`,
          }),
          metricCard({
            label: "Lead booking rate",
            value: fmt.percent(overview.leads.book_rate, { digits: 1 }),
            foot: `${fmt.number(overview.leads.booked)} of ${fmt.number(overview.leads.total)} leads booked`,
          }),
          metricCard({
            label: "Missed appointments",
            value: fmt.percent(engine.appointments.no_show_rate, { digits: 1 }),
            foot: `${fmt.number(engine.appointments.no_shows)} of ${fmt.number(engine.appointments.total)} in this period`,
          })
        ),
        overview.calls.total === 0 && !state.system?.integrations?.find((i) => i.id === "phone")?.connected
          ? note(
              "Your phone system is not connected yet, so call numbers are empty rather than zero. Connect it in Settings to let the AI Receptionist answer.",
              "warn"
            )
          : null
      );
    },
    { skeleton: () => skeletonCards(4, { tall: true }), context: "Couldn't load your headline numbers" }
  );
}

/* -------------------------------------------------------------------------
   Needs your attention
   ------------------------------------------------------------------------- */
function renderAttention(target) {
  const body = el("div");
  target.replaceChildren(
    sectionHeader({
      id: "attention-heading",
      title: "Needs your attention",
      subtitle: "Ranked by urgency and how long it has been waiting.",
      actions: [
        button({ label: "See all", variant: "ghost", size: "sm", trailingIcon: "arrowRight", href: "#/opportunities" }),
      ],
    }),
    body
  );

  return renderAsync(
    body,
    () => load.opportunities(),
    (items) => {
      if (!items.length) return el("div.card", null, emptyOpportunities());
      const top = items.slice(0, 3);
      return el(
        "div.grid.grid--3",
        null,
        top.map((item) =>
          opportunityCard(item, {
            compact: true,
            onOpen: openOpportunity,
            onAct: (opportunity, action) =>
              runOpportunityAction(opportunity, action, {
                onDone: () => renderAttention(target),
              }),
          })
        )
      );
    },
    { skeleton: () => skeletonCards(3, { tall: true }), context: "Couldn't load what needs your attention" }
  );
}

/* -------------------------------------------------------------------------
   Your AI team
   ------------------------------------------------------------------------- */
function renderTeam(target) {
  const body = el("div");
  target.replaceChildren(
    sectionHeader({
      id: "team-heading",
      title: "Your AI team",
      subtitle: "Working behind the scenes, around the clock.",
      actions: [
        button({ label: "View team", variant: "ghost", size: "sm", trailingIcon: "arrowRight", href: "#/team" }),
      ],
    }),
    body
  );

  return renderAsync(
    body,
    () => load.agents(),
    (agents) =>
      el(
        "div.grid.grid--3",
        null,
        agents.slice(0, 3).map((agent) => agentCard(agent, { compact: true }))
      ),
    { skeleton: () => skeletonCards(3, { tall: true }), context: "Couldn't load your AI team" }
  );
}
