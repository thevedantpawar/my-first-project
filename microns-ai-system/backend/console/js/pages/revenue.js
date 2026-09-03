/**
 * Revenue — where the engine is recovering business, and how much of that
 * the engine can actually see.
 *
 * The honesty rule matters more here than anywhere else in the product. An
 * appointment's price is optional in this system, and most rows do not carry
 * one. Rather than inferring a number from an average, this page shows the
 * recovered *appointments* — which are counted exactly — and shows money only
 * for the rows that recorded it, with the coverage stated on the page.
 */

import { el } from "../dom.js";
import * as fmt from "../format.js";
import { load, state } from "../store.js";
import {
  badge,
  heroMetric,
  metricCard,
  note,
  pageHeader,
  sectionHeader,
  skeletonCards,
} from "../ui/components.js";
import { barList, funnel } from "../ui/charts.js";
import { renderAsync, coverageNote } from "./common.js";

const ATTRIBUTION_LABELS = {
  ai_booked: ["Booked by your AI", "Phone, chat or text bookings the agents created."],
  recovered_no_show: ["Recovered after a missed visit", "Rebooked after the engine sent a recovery message."],
  reactivated: ["Reactivated clients", "Booked after a dormant-client offer went out."],
  front_desk: ["Booked by your team", "Created by staff or your practice calendar."],
};

export async function renderRevenue(container) {
  const body = el("div");

  container.replaceChildren(
    pageHeader({
      eyebrow: "Revenue recovery",
      title: "Revenue",
      subtitle: "See where your AI Revenue Engine is recovering opportunities.",
      actions: [badge(`Last ${state.windowDays} days`, "neutral")],
    }),
    body
  );

  return renderAsync(
    body,
    () => Promise.all([load.revenue(), load.overview()]),
    ([revenue, overview]) => {
      const priced = revenue.completed.priced_count > 0;

      return el(
        "div.stack.stack--loose",
        null,
        heroMetric({
          eyebrow: "Completed appointment value",
          value: priced ? fmt.money(revenue.completed.cents) : "Not recorded",
          empty: !priced,
          label: priced
            ? `From ${fmt.pluralise(revenue.completed.priced_count, "completed appointment")} with a recorded price`
            : "No completed appointment has a recorded price",
          note: priced
            ? undefined
            : "This engine does not require a price on an appointment, and none of yours carry one. Record prices — through your practice calendar or the appointment record — and this figure fills in. Everything else on this page is counted, not estimated.",
          side: el(
            "div.row",
            { style: { gap: "var(--space-7)", flexWrap: "wrap" } },
            sideMetric(
              "Recovered appointments",
              fmt.number(revenue.recovered_appointments),
              "won back after a missed visit or a lapse"
            ),
            sideMetric(
              "Booked by your AI",
              fmt.number(revenue.attribution.ai_booked.count),
              `of ${fmt.number(revenue.coverage.appointments)} created in this period`
            )
          ),
        }),

        coverageNote(revenue.coverage),

        el(
          "section.section",
          null,
          sectionHeader({
            title: "Where the bookings came from",
            subtitle: "Counted from the source recorded on each appointment — not inferred.",
          }),
          el(
            "div.stack",
            null,
            el(
              "div.card",
              null,
              barList({
                items: Object.entries(revenue.attribution).map(([key, value]) => ({
                  label: ATTRIBUTION_LABELS[key][0],
                  value: value.count,
                  hint:
                    value.priced_count > 0
                      ? `${fmt.money(value.cents)} recorded`
                      : "no price recorded",
                  colour: key === "front_desk" ? "ink-faint" : undefined,
                })),
                formatValue: (value) => fmt.pluralise(value, "appointment"),
                emptyLabel: "No appointments were created in this period.",
              })
            ),
            el(
              "div.grid.grid--4",
              null,
              ...Object.entries(revenue.attribution).map(([key, value]) =>
                el(
                  "div.card.card--quiet",
                  null,
                  el("p.small", { style: { fontWeight: "var(--weight-semibold)" }, text: ATTRIBUTION_LABELS[key][0] }),
                  el("p.xsmall.muted", { text: ATTRIBUTION_LABELS[key][1] }),
                  el(
                    "p.small",
                    { style: { marginTop: "var(--space-2)" } },
                    el("span.numeric", { style: { fontWeight: "var(--weight-semibold)" }, text: fmt.number(value.count) }),
                    el("span.muted", { text: value.priced_count ? ` · ${fmt.money(value.cents)}` : " · value not recorded" })
                  )
                )
              )
            )
          )
        ),

        el(
          "section.section",
          null,
          sectionHeader({
            title: "Your funnel",
            subtitle: `Each stage counted from its own records over the last ${revenue.window_days} days.`,
          }),
          el(
            "div.grid.grid--sidebar",
            null,
            el(
              "div.stack",
              null,
              el(
                "div.card",
                null,
                el("p.eyebrow", { style: { marginBottom: "var(--space-4)" }, text: "Enquiry to booking" }),
                funnel({ stages: leadStages(revenue.funnel) })
              ),
              el(
                "div.card",
                null,
                el("p.eyebrow", { style: { marginBottom: "var(--space-4)" }, text: "Booking to rebooking" }),
                funnel({ stages: appointmentStages(revenue.funnel) })
              )
            ),
            el(
              "div.stack",
              null,
              metricCard({
                label: "Lead booking rate",
                value: fmt.percent(overview.leads.book_rate, { digits: 1 }),
                foot: `${fmt.number(overview.leads.booked)} of ${fmt.number(overview.leads.total)} leads`,
              }),
              metricCard({
                label: "Completion rate",
                value: fmt.percent(overview.engine.appointments.completion_rate, { digits: 1 }),
                foot: `${fmt.number(overview.engine.appointments.completed)} of ${fmt.number(overview.engine.appointments.total)} appointments completed`,
              }),
              metricCard({
                label: "Recovery rate",
                value: fmt.percent(overview.engine.reactivation.recovery_rate, { digits: 1 }),
                foot: `${fmt.number(overview.engine.reactivation.rebooked)} rebooked from ${fmt.number(overview.engine.reactivation.sent)} messages`,
              }),
              note(
                "These are two funnels, not one. An appointment can exist without a lead — a call straight to your front desk, for example — so joining them into a single line would invent a conversion rate that does not exist.",
                "neutral"
              )
            )
          )
        ),

        el(
          "section.section",
          null,
          sectionHeader({ title: "Still on the books", subtitle: "Scheduled but not yet completed." }),
          el(
            "div.grid.grid--3",
            null,
            metricCard({
              label: "Scheduled appointments",
              value: fmt.number(revenue.scheduled.count),
              foot: "pending or confirmed",
            }),
            metricCard({
              label: "Recorded value scheduled",
              value: revenue.scheduled.priced_count ? fmt.money(revenue.scheduled.cents) : fmt.EMPTY,
              foot: revenue.scheduled.priced_count
                ? `${fmt.number(revenue.scheduled.priced_count)} with a price`
                : "no prices recorded",
            }),
            metricCard({
              label: "Missed appointments",
              value: fmt.number(overview.engine.appointments.no_shows),
              foot: `${fmt.percent(overview.engine.appointments.no_show_rate, { digits: 1 })} of the period`,
            })
          )
        )
      );
    },
    { skeleton: () => skeletonCards(4, { tall: true }), context: "Couldn't load revenue" }
  );
}

/** The stages counted from the leads table. */
function leadStages(rows) {
  return rows
    .filter((row) => row.source === "leads")
    .map((row) => ({ label: row.stage, value: row.value }));
}

/** The stages counted from appointments and retention events. */
function appointmentStages(rows) {
  return rows
    .filter((row) => row.source !== "leads")
    .map((row, index) => ({
      label: row.stage,
      value: row.value,
      // The rebooking count comes from a different table again, so no
      // conversion rate is drawn into it.
      newSource: row.source === "retention_events",
    }));
}

function sideMetric(label, value, foot) {
  return el(
    "div.stack",
    { style: { gap: "2px" } },
    el("span.eyebrow", { text: label }),
    el("span.metric__value", { text: value }),
    el("span.xsmall.muted", { style: { maxWidth: "22ch", display: "block" }, text: foot })
  );
}
