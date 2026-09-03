/**
 * Insights — plain-language observations, each carrying the count behind it.
 *
 * Every card here states its basis. An insight whose evidence you cannot see
 * is an opinion, and this product does not sell opinions to clinic owners.
 */

import { el } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { load, state } from "../store.js";
import {
  badge,
  button,
  emptyState,
  metricCard,
  note,
  pageHeader,
  sectionHeader,
  skeletonCards,
} from "../ui/components.js";
import { barList, donut } from "../ui/charts.js";
import { renderAsync } from "./common.js";

const TONE_ICON = { positive: "checkCircle", attention: "alert", info: "info" };
const TONE_BADGE = { positive: "positive", attention: "attention", info: "info" };

export async function renderInsights(container) {
  const body = el("div");

  container.replaceChildren(
    pageHeader({
      eyebrow: "Insights",
      title: "What the numbers are telling you",
      subtitle: `Observations from the last ${state.windowDays} days, each one counted rather than estimated.`,
    }),
    body
  );

  return renderAsync(
    body,
    () => Promise.all([load.insights(), load.overview()]),
    ([insights, overview]) =>
      el(
        "div.stack.stack--loose",
        null,
        insights.length
          ? el("div.grid.grid--2", null, insights.map(insightCard))
          : el(
              "div.card",
              null,
              emptyState({
                iconName: "insights",
                title: "Not enough activity yet",
                body: "Insights appear once your engine has handled enough leads, calls and appointments to say something true about them.",
                actions: [button({ label: "See opportunities", variant: "secondary", href: "#/opportunities" })],
              })
            ),

        el(
          "section.section",
          null,
          sectionHeader({
            ruled: true,
            title: "Performance",
            subtitle: "The four numbers most worth watching week to week.",
          }),
          el(
            "div.grid.grid--sidebar",
            null,
            el(
              "div.card",
              null,
              barList({
                items: [
                  { label: "Leads captured", value: overview.leads.total },
                  { label: "Qualified", value: overview.leads.total - overview.leads.cold },
                  { label: "Booked", value: overview.leads.booked },
                  { label: "Appointments completed", value: overview.engine.appointments.completed },
                  { label: "Missed", value: overview.engine.appointments.no_shows, colour: "critical" },
                ],
                formatValue: fmt.number,
              })
            ),
            el(
              "div.card",
              { style: { display: "flex", gap: "var(--space-5)", alignItems: "center", flexWrap: "wrap" } },
              donut({
                value: overview.leads.booked,
                total: overview.leads.total || 1,
                label: "Leads that booked",
                sublabel: "booked",
              }),
              el(
                "div.stack.stack--tight",
                { style: { minWidth: "160px" } },
                el("p.card-title", { text: "Lead conversion" }),
                el("p.small.secondary", {
                  text: `${fmt.number(overview.leads.booked)} of ${fmt.number(overview.leads.total)} leads reached a booking in this period.`,
                }),
                el(
                  "div.row.row--wrap",
                  { style: { gap: "var(--space-2)" } },
                  badge(`${fmt.number(overview.leads.hot)} high intent`, "accent"),
                  badge(`${fmt.number(overview.leads.warm)} medium`, "attention"),
                  badge(`${fmt.number(overview.leads.cold)} low`, "neutral")
                )
              )
            )
          )
        ),

        el(
          "section.section",
          null,
          sectionHeader({ ruled: true, title: "Messages your engine sent", subtitle: "Reminders, recovery, reviews and follow-ups." }),
          el(
            "div.grid.grid--4",
            null,
            metricCard({
              label: "Reminders",
              value: fmt.number(overview.engine.reminders.sent_24h + overview.engine.reminders.sent_2h),
              foot: "24-hour and 2-hour",
            }),
            metricCard({
              label: "Recovery messages",
              value: fmt.number(overview.engine.reactivation.sent),
              foot: `${fmt.number(overview.engine.reactivation.rebooked)} rebooked`,
            }),
            metricCard({
              label: "Review requests",
              value: fmt.number(overview.engine.reviews.requested),
              foot: `${fmt.number(overview.engine.reviews.received)} reviews received`,
            }),
            metricCard({
              label: "Clients at risk",
              value: fmt.number(overview.engine.reactivation.patients_at_risk),
              foot: "no recent visit, nothing booked",
            })
          ),
          messagingCaveat()
        )
      ),
    { skeleton: () => skeletonCards(4, { tall: true }), context: "Couldn't load insights" }
  );
}

function insightCard(insight) {
  const tone = TONE_BADGE[insight.tone] || "info";
  return el(
    "article.card",
    { style: { display: "flex", gap: "var(--space-4)", alignItems: "flex-start" } },
    el(
      "span",
      {
        style: {
          width: "34px",
          height: "34px",
          borderRadius: "var(--radius-md)",
          background: `var(--${tone}-bg)`,
          color: `var(--${tone})`,
          display: "grid",
          placeItems: "center",
          flex: "none",
        },
      },
      icon(TONE_ICON[insight.tone] || "info", 17)
    ),
    el(
      "div.stack.stack--tight",
      { style: { minWidth: 0 } },
      el("h3.card-title", { text: insight.headline }),
      el("p.small.secondary", { text: insight.detail }),
      el("p.xsmall.muted", { text: insight.basis })
    )
  );
}

function messagingCaveat() {
  const sms = state.system?.integrations?.find((integration) => integration.id === "sms");
  if (!sms || sms.connected) return null;
  return note(
    "Text messaging is not connected. These messages were composed, audited and counted, but not delivered to anyone.",
    "warn"
  );
}
