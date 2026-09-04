/**
 * The Revenue Command Center — the page a med spa owner opens in the morning.
 *
 * It has ten seconds to answer four questions, in this order:
 *
 *   1. How much business did Microns bring in?
 *   2. What happened today?
 *   3. What needs me?
 *   4. Is my AI team actually working?
 *
 * The layout follows that order literally and refuses to be a grid of equal
 * cards, because a grid of equal cards says everything matters the same
 * amount. Money is set at display size. Attention is a working queue with the
 * action on each row. The team is a strip, not a table.
 *
 * One request feeds the whole page. It is opened first thing on a front-desk
 * laptop, and six parallel round trips is six chances to look slow.
 *
 * The honesty rules that govern the rest of the console apply here hardest,
 * because this is the screen people quote in meetings: the headline says
 * *influenced*, never *earned*; it captions itself as projected or collected
 * depending on where the prices came from; and no arrow appears without a
 * real previous period behind it.
 */

import { el } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { load, state } from "../store.js";
import {
  badge,
  button,
  pageHeader,
  revenueHero,
  sectionHeader,
  skeletonCards,
} from "../ui/components.js";
import { barList } from "../ui/charts.js";
import { renderAsync, opportunityCard } from "./common.js";
import { openOpportunity } from "./opportunities.js";

export async function renderOverview(container) {
  const demo = state.system?.demo;
  const clinic =
    demo?.active && demo?.seeded ? demo.clinic : state.system?.clinic?.name;

  container.replaceChildren(
    pageHeader({
      eyebrow: `${fmt.greeting()} · ${fmt.today()}`,
      title: clinic || "Your revenue engine",
      subtitle: "Your AI team has been working while you run the clinic.",
      actions: [
        button({
          label: "Recovery",
          variant: "secondary",
          iconName: "refresh",
          href: "#/recovery",
        }),
        button({
          label: "Revenue",
          variant: "primary",
          trailingIcon: "arrowRight",
          href: "#/revenue",
        }),
      ],
    }),
    el("div", { id: "command-center" })
  );

  return renderAsync(
    container.querySelector("#command-center"),
    () => load.commandCenter(),
    (data) =>
      el(
        "div",
        null,
        heroSection(data),
        todayStrip(data.today),
        el("div.section", null, attentionSection(data)),
        el(
          "div.section",
          null,
          el("div.grid.grid--feature", null, activitySection(data.activity), teamSection(data))
        )
      ),
    {
      skeleton: () => el("div.stack.stack--loose", null, skeletonCards(4)),
      context: "Couldn't load your command center",
    }
  );
}

/* -------------------------------------------------------------------------
   Hero — revenue influenced
   ------------------------------------------------------------------------- */

/**
 * How the headline figure describes itself.
 *
 * An owner is entitled to know whether they are looking at money that has
 * been collected or a forecast built from their own price list, and the
 * difference is not a footnote — it changes what the number means.
 */
const BASIS_NOTES = {
  recorded:
    "Based on prices recorded against each appointment by your booking system.",
  expected:
    "Projected from your service price list. These appointments are booked, not yet paid.",
  mixed:
    "Part recorded by your booking system, part projected from your service price list.",
  none: "No appointment in this period carries a price yet.",
};

function heroSection(data) {
  const headline = data.headline;
  const empty = headline.cents === 0;

  const stats = data.revenue_split
    .filter((row) => row.key !== "front_desk")
    .map((row) => ({
      label: row.label,
      value: row.cents ? fmt.money(row.cents) : fmt.pluralise(row.count, "appointment"),
      foot:
        row.complimentary > 0
          ? `${row.count} booked · ${row.complimentary} complimentary`
          : fmt.pluralise(row.count, "appointment"),
    }));

  return revenueHero({
    eyebrow: `Revenue influenced · last ${data.window_days} days`,
    value: empty ? "Not yet recorded" : fmt.money(headline.cents),
    label: empty
      ? "Once appointments carry a price, this is where the number appears."
      : `across ${fmt.pluralise(headline.appointments, "appointment")} your AI team booked or brought back`,
    note: BASIS_NOTES[headline.basis],
    empty,
    stats,
    aside: heroAside(data),
  });
}

function heroAside(data) {
  const frontDesk = data.revenue_split.find((row) => row.key === "front_desk");
  const influenced = data.headline.cents;
  const total = influenced + (frontDesk ? frontDesk.cents : 0);

  if (!total) return null;

  return el(
    "div.stack",
    { style: { gap: "var(--space-4)" } },
    el("span.eyebrow", { text: "Where the bookings came from" }),
    barList({
      items: data.revenue_split.map((row) => ({
        label: row.label,
        value: row.cents,
        hint: fmt.pluralise(row.count, "appt", "appts"),
        colour: row.key === "front_desk" ? "neutral-line" : null,
      })),
      formatValue: (cents) => fmt.money(cents),
    })
  );
}

/* -------------------------------------------------------------------------
   Today
   ------------------------------------------------------------------------- */
function todayStrip(counters) {
  const quiet = counters.every((counter) => counter.value === 0);

  return el(
    "section.today",
    { "aria-label": "Today so far" },
    el(
      "div.today__row",
      null,
      counters.map((counter) =>
        el(
          "div.today__cell",
          null,
          el("span.today__value.numeric", { text: fmt.number(counter.value) }),
          el("span.today__label", { text: counter.label })
        )
      )
    ),
    quiet
      ? el("p.xsmall.muted", {
          style: { marginTop: "var(--space-3)" },
          text: "Nothing yet today. These count from midnight.",
        })
      : null
  );
}

/* -------------------------------------------------------------------------
   Needs your attention
   ------------------------------------------------------------------------- */
function attentionSection(data) {
  const items = data.attention || [];
  const remaining = Math.max(data.attention_total - items.length, 0);

  return el(
    "section",
    { "aria-labelledby": "attention-heading" },
    sectionHeader({
      id: "attention-heading",
      title: "Needs your attention",
      subtitle: items.length
        ? "Ranked by urgency. Clinical callbacks always come first."
        : null,
      actions: items.length
        ? [
            button({
              label: remaining ? `See all ${data.attention_total}` : "Open queue",
              variant: "ghost",
              trailingIcon: "arrowRight",
              href: "#/opportunities",
            }),
          ]
        : [],
    }),
    items.length
      ? el(
          "div.grid.grid--cards",
          null,
          items.map((item) =>
            opportunityCard(item, { onOpen: () => openOpportunity(item), compact: true })
          )
        )
      : el(
          "div.card",
          null,
          el(
            "div.stack.stack--tight",
            null,
            el("p.card-title", { text: "Nothing is waiting on you" }),
            el("p.small.secondary", {
              text: "Your AI team is handling everything currently in the pipeline. New enquiries, missed appointments and clinical callbacks appear here the moment they need a person.",
            })
          )
        )
  );
}

/* -------------------------------------------------------------------------
   Your AI team
   ------------------------------------------------------------------------- */
const TEAM_TONES = {
  live: "success",
  degraded: "warning",
  not_connected: "neutral",
  disabled: "neutral",
};

const TEAM_LABELS = {
  live: "Working",
  degraded: "Needs attention",
  not_connected: "Not connected",
  disabled: "Off",
};

function teamSection(data) {
  return el(
    "section.card",
    { "aria-labelledby": "team-heading" },
    sectionHeader({
      id: "team-heading",
      ruled: true,
      title: "Your AI team",
      actions: [
        button({
          label: "View team",
          variant: "ghost",
          trailingIcon: "arrowRight",
          href: "#/team",
        }),
      ],
    }),
    el(
      "ul.team-list",
      null,
      data.team.map((agent) =>
        el(
          "li.team-list__row",
          null,
          el(
            "div.team-list__head",
            null,
            el("span.team-list__name", { text: agent.name }),
            badge(TEAM_LABELS[agent.status] || agent.status, TEAM_TONES[agent.status] || "neutral", {
              dot: true,
            })
          ),
          el(
            "div.team-list__body",
            null,
            el("span.team-list__detail", { text: agent.status_detail || agent.role }),
            agent.headline
              ? el(
                  "div.team-list__figure",
                  null,
                  el("span.team-list__metric.numeric", {
                    text: `${fmt.number(agent.headline.value)}${agent.headline.unit || ""}`,
                  }),
                  el("span.xsmall.muted", { text: agent.headline.label })
                )
              : null
          )
        )
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Recent activity
   ------------------------------------------------------------------------- */
const ACTOR_ICONS = {
  "AI Receptionist": "phone",
  "Lead Concierge": "leads",
  Booking: "calendar",
  Recovery: "refresh",
  Reactivation: "refresh",
  Reviews: "star",
  Retention: "workflow",
};

/**
 * Collapse consecutive identical entries into one row with a count.
 *
 * Reminders go out in batches, so an honest feed of real events is often
 * eight rows of "Reminder sent" in a row — accurate, and useless. Grouping
 * only ever merges *adjacent* rows with the same actor and text, so nothing
 * is hidden and the ordering still reflects what happened; the timestamp
 * shown is the most recent of the group.
 */
function groupRuns(items) {
  const grouped = [];
  for (const item of items) {
    const previous = grouped[grouped.length - 1];
    if (previous && previous.actor === item.actor && previous.text === item.text) {
      previous.count += 1;
      previous.details.push(item.detail);
      continue;
    }
    grouped.push({ ...item, count: 1, details: [item.detail] });
  }
  return grouped;
}

function activitySection(items) {
  // Grouped first, then capped: ten rows of distinct work reads better than
  // ten rows of the same reminder, and better than thirty rows of anything.
  const rows = groupRuns(items).slice(0, 10);
  return el(
    "section",
    { "aria-labelledby": "activity-heading" },
    sectionHeader({
      id: "activity-heading",
      title: "What your AI team just did",
      subtitle: items.length ? null : "Real events only — nothing here is simulated.",
    }),
    el(
      "div.card.card--flush",
      null,
      rows.length
        ? el(
            "ul.feed",
            null,
            rows.map((item) => {
              const named = item.details.filter(Boolean);
              const subtitle =
                item.count > 1
                  ? [item.actor, `${named.slice(0, 2).join(", ")}${named.length > 2 ? ` and ${named.length - 2} more` : ""}`]
                      .filter(Boolean)
                      .join(" · ")
                  : [item.actor, item.detail].filter(Boolean).join(" · ");

              return el(
                "li.feed__row",
                null,
                el(
                  "span",
                  { class: `feed__icon feed__icon--${item.tone || "neutral"}` },
                  icon(ACTOR_ICONS[item.actor] || "sparkle", 15)
                ),
                el(
                  "div.stack",
                  { style: { gap: "1px", minWidth: 0 } },
                  el(
                    "span.row",
                    { style: { gap: "var(--space-2)", alignItems: "baseline" } },
                    el("span.small", { text: item.text }),
                    item.count > 1
                      ? el("span.feed__count.numeric", { text: `×${item.count}` })
                      : null
                  ),
                  el("span.xsmall.muted", { text: subtitle })
                ),
                el("span.xsmall.muted.feed__time", { text: fmt.relative(item.at) })
              );
            })
          )
        : el(
            "div",
            { style: { padding: "var(--space-6)" } },
            el("p.small.secondary", {
              text: "Nothing has happened yet. When your AI team answers an enquiry, books a visit or chases a missed appointment, it appears here.",
            })
          )
    )
  );
}
