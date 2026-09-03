/**
 * Overview — the page a med spa owner opens in the morning.
 *
 * The composition answers four questions in order, and the layout is
 * deliberately asymmetric rather than a grid of equal cards: money first at
 * display size, then what needs a person, then what the team did.
 */

import { el } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { load, state } from "../store.js";
import {
  badge,
  button,
  metricCard,
  note,
  pageHeader,
  revenueHero,
  sectionHeader,
  skeletonCards,
  trendIndicator,
} from "../ui/components.js";
import { sparkline } from "../ui/charts.js";
import { renderAsync, opportunityCard, runOpportunityAction, emptyOpportunities } from "./common.js";
import { openOpportunity } from "./opportunities.js";
import { agentStrip } from "./team.js";

export async function renderOverview(container) {
  const clinic = state.system?.clinic?.name || "your clinic";

  const heroSlot = el("section");
  const attentionSlot = el("section", { "aria-labelledby": "attention-heading" });
  const teamSlot = el("section", { "aria-labelledby": "team-heading" });

  container.replaceChildren(
    pageHeader({
      eyebrow: `${fmt.greeting()} · ${fmt.today()}`,
      title: clinic === "your clinic" ? "Your revenue engine" : clinic,
      subtitle: "Here's what your AI Revenue Team handled, and what still needs you.",
      actions: [
        button({ label: "Opportunities", variant: "secondary", iconName: "opportunity", href: "#/opportunities" }),
        button({ label: "Revenue", variant: "primary", trailingIcon: "arrowRight", href: "#/revenue" }),
      ],
    }),
    heroSlot,
    el("div.section", null, attentionSlot),
    el("div.section", null, teamSlot)
  );

  renderHero(heroSlot);
  renderAttention(attentionSlot);
  renderTeam(teamSlot);
}

/* -------------------------------------------------------------------------
   Hero: revenue, its supporting stats, and real activity beside it
   ------------------------------------------------------------------------- */
function renderHero(target) {
  return renderAsync(
    target,
    () => Promise.all([load.overview(), load.revenue()]),
    ([overview, revenue]) => {
      const completed = revenue.completed;
      const priced = completed.priced_count > 0;
      const engine = overview.engine;

      const hero = revenueHero({
        eyebrow: `AI-influenced revenue · last ${revenue.window_days} days`,
        value: priced ? fmt.money(completed.cents) : "Not recorded",
        empty: !priced,
        label: priced
          ? `From ${fmt.pluralise(completed.priced_count, "completed appointment")} with a recorded price`
          : "No completed appointment carries a recorded price",
        note: priced
          ? `${fmt.number(completed.count - completed.priced_count)} further completed appointments have no price recorded, so they are not counted here.`
          : "Your engine tracks bookings and recovery today. Record a price on an appointment and this fills in. Everything else on this page is counted, not estimated.",
        stats: [
          {
            label: "Recovered",
            value: fmt.number(revenue.recovered_appointments),
            foot: "appointments won back",
          },
          {
            label: "Booked by your AI",
            value: fmt.number(overview.bookings.ai_assisted),
            foot: `of ${fmt.number(overview.bookings.created)} created`,
          },
          {
            label: "New leads",
            value: fmt.number(overview.leads.total),
            trend: overview.trend?.leads,
            foot: `${fmt.number(overview.leads.hot)} high intent`,
          },
          {
            label: "Missed visits",
            value: fmt.percent(engine.appointments.no_show_rate, { digits: 1 }),
            foot: `${fmt.number(engine.appointments.no_shows)} of ${fmt.number(engine.appointments.total)}`,
          },
        ],
        aside: activityAside(overview),
      });

      return el(
        "div.stack.stack--loose",
        null,
        hero,
        supportingRow(overview),
        phoneNotice()
      );
    },
    { skeleton: heroSkeleton, context: "Couldn't load your headline numbers" }
  );
}

function activityAside(overview) {
  const series = overview.activity?.leads || [];
  return el(
    "div.stack.stack--tight",
    null,
    el(
      "div.row.row--between",
      null,
      el("span.eyebrow", { text: "Lead activity" }),
      trendIndicator(overview.trend?.leads)
    ),
    sparkline({
      points: series,
      ariaLabel: "New leads per day over the period",
    })
  );
}

/**
 * The supporting row. Not four identical tiles: the first two carry the
 * numbers an owner acts on, the last two are quieter readings.
 */
function supportingRow(overview) {
  const engine = overview.engine;
  return el(
    "div.grid.grid--4",
    null,
    metricCard({
      label: "Appointments booked",
      value: fmt.number(overview.bookings.created),
      trend: overview.trend?.appointments,
      foot: `${fmt.number(overview.bookings.today)} scheduled today`,
      lead: true,
    }),
    metricCard({
      label: "Lead booking rate",
      value: fmt.percent(overview.leads.book_rate, { digits: 1 }),
      foot: `${fmt.number(overview.leads.booked)} of ${fmt.number(overview.leads.total)} leads booked`,
      lead: true,
    }),
    metricCard({
      label: "Messages sent",
      value: fmt.number(overview.messages_sent),
      foot: "reminders, recovery and follow-ups",
      quiet: true,
    }),
    metricCard({
      label: "Clients at risk",
      value: fmt.number(engine.reactivation.patients_at_risk),
      foot: "no recent visit, nothing booked",
      quiet: true,
    })
  );
}

function phoneNotice() {
  const phone = state.system?.integrations?.find((integration) => integration.id === "phone");
  if (!phone || phone.connected) return null;
  return note(
    "Your phone system is not connected, so call figures are empty rather than zero. Connect it in Settings to let the AI Receptionist answer.",
    "warn"
  );
}

function heroSkeleton() {
  return el(
    "div.stack.stack--loose",
    { "aria-hidden": "true" },
    el("div.skeleton.skeleton--hero"),
    skeletonCards(4)
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
      subtitle: "Ranked by urgency, then by how long it has been waiting.",
      ruled: true,
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
      if (!items.length) return el("div.panel", null, emptyOpportunities());
      return el(
        "div.grid.grid--3",
        null,
        items.slice(0, 3).map((item) =>
          opportunityCard(item, {
            compact: true,
            onOpen: openOpportunity,
            onAct: (opportunity, action) =>
              runOpportunityAction(opportunity, action, { onDone: () => renderAttention(target) }),
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
      ruled: true,
      actions: [
        button({ label: "View team", variant: "ghost", size: "sm", trailingIcon: "arrowRight", href: "#/team" }),
      ],
    }),
    body
  );

  return renderAsync(
    body,
    () => load.agents(),
    (agents) => agentStrip(agents),
    { skeleton: () => skeletonCards(3, { tall: true }), context: "Couldn't load your AI team" }
  );
}
