/**
 * Recovery — missed appointments and dormant clients, won back.
 *
 * This is the most persuasive screen in the product and therefore the one
 * most in need of discipline. "91% recovery rate" is the kind of figure that
 * sells a subscription and then evaporates under a single follow-up question,
 * so every rate on this page shows its denominator next to it, in the same
 * type size, without being asked.
 *
 * The stories underneath are the point. A percentage is an argument; a list
 * of specific missed appointments, each with the message that went out and
 * what happened next, is evidence. Names are masked here exactly as they are
 * everywhere else — an owner does not need a surname to recognise their own
 * patient.
 */

import { el } from "../dom.js";
import * as fmt from "../format.js";
import { load } from "../store.js";
import {
  badge,
  button,
  note,
  pageHeader,
  progressBar,
  sectionHeader,
  skeletonCards,
  dataTable,
  emptyState,
} from "../ui/components.js";
import { renderAsync } from "./common.js";

export async function renderRecovery(container) {
  container.replaceChildren(
    pageHeader({
      eyebrow: "Retention",
      title: "Recovery",
      subtitle:
        "Missed appointments and clients who stopped coming — what your AI team did about them.",
      actions: [
        button({
          label: "Automations",
          variant: "secondary",
          iconName: "workflow",
          href: "#/automations",
        }),
      ],
    }),
    el("div", { id: "recovery-body" })
  );

  return renderAsync(
    container.querySelector("#recovery-body"),
    () => load.recovery(),
    (data) =>
      el(
        "div",
        null,
        el("p.small.muted", {
          style: { marginBottom: "var(--space-5)" },
          text: `Counted over the last ${data.window_days} days. Recovery is a slower loop than the rest of the console, so this page uses a wider window.`,
        }),
        el("div.grid.grid--split", null, missedPanel(data.missed), dormantPanel(data.dormant)),
        el("div.section", null, storiesSection(data.stories))
      ),
    {
      skeleton: () => el("div.stack.stack--loose", null, skeletonCards(2, { tall: true })),
      context: "Couldn't load your recovery numbers",
    }
  );
}

/**
 * A rate and the fraction it came from, side by side.
 *
 * Never renders a percentage on its own. Three out of five and six hundred
 * out of a thousand are both "60%" and they are not the same clinic.
 */
function rateBlock({ label, rate, basis, tone = "accent" }) {
  return el(
    "div.stack.stack--tight",
    null,
    el("span.eyebrow", { text: label }),
    el(
      "div.row",
      { style: { gap: "var(--space-3)", alignItems: "baseline" } },
      el("span.hero__value.numeric", {
        style: { fontSize: "var(--text-hero)" },
        text: `${rate}%`,
      })
    ),
    el("span.small.secondary", { text: basis }),
    progressBar(rate, 100, { tone })
  );
}

function statRow(pairs) {
  return el(
    "div.stat-row",
    null,
    pairs.map(([label, value, foot]) =>
      el(
        "div.stat-row__cell",
        null,
        el("span.eyebrow", { text: label }),
        el("span.metric__value.numeric", { text: value }),
        foot ? el("span.xsmall.muted", { text: foot }) : null
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Missed appointments
   ------------------------------------------------------------------------- */
function missedPanel(missed) {
  const nothing = missed.total === 0;

  return el(
    "section.card",
    { "aria-labelledby": "missed-heading" },
    sectionHeader({
      id: "missed-heading",
      ruled: true,
      title: "Missed appointments",
      subtitle: "No-shows and cancellations, and who came back.",
    }),
    nothing
      ? emptyState({
          iconName: "check",
          title: "No missed appointments",
          body: "Nobody has missed or cancelled a visit in this period. When it happens, your Recovery agent reaches out the same day and the outcome is tracked here.",
        })
      : el(
          "div.stack.stack--loose",
          null,
          statRow([
            ["No-shows", fmt.number(missed.no_shows)],
            ["Cancellations", fmt.number(missed.cancellations)],
            ["Contacted", fmt.number(missed.contacted), `${missed.contact_rate}% of misses`],
            ["Came back", fmt.number(missed.recovered)],
          ]),
          rateBlock({
            label: "Recovery rate",
            rate: missed.recovery_rate,
            basis: missed.basis,
          }),
          missed.value_cents
            ? note(
                `${fmt.money(missed.value_cents)} of appointment value rebooked. Priced from the service value on each recovered appointment.`,
                "good"
              )
            : note(
                "None of the recovered appointments carries a price yet, so no value is shown.",
                "neutral"
              )
        )
  );
}

/* -------------------------------------------------------------------------
   Dormant clients
   ------------------------------------------------------------------------- */
function dormantPanel(dormant) {
  const nothing = dormant.identified === 0;

  return el(
    "section.card",
    { "aria-labelledby": "dormant-heading" },
    sectionHeader({
      id: "dormant-heading",
      ruled: true,
      title: "Dormant clients",
      subtitle: `Anyone who hasn't visited in ${dormant.threshold_days} days.`,
    }),
    nothing
      ? emptyState({
          iconName: "user",
          title: "No dormant clients",
          body: `Every client on your list has visited within the last ${dormant.threshold_days} days.`,
        })
      : el(
          "div.stack.stack--loose",
          null,
          statRow([
            ["Identified", fmt.number(dormant.identified)],
            ["Contacted", fmt.number(dormant.contacted)],
            ["Came back", fmt.number(dormant.returned)],
            [
              "Value",
              dormant.value_cents ? fmt.money(dormant.value_cents) : fmt.EMPTY,
            ],
          ]),
          rateBlock({
            label: "Return rate",
            rate: dormant.return_rate,
            basis: dormant.basis,
          }),
          dormant.contacted < dormant.identified
            ? note(
                `${dormant.identified - dormant.contacted} dormant clients have not been contacted yet. Your Reactivation agent works through them on a schedule.`,
                "neutral"
              )
            : null
        )
  );
}

/* -------------------------------------------------------------------------
   The individual stories
   ------------------------------------------------------------------------- */
function storiesSection(stories) {
  return el(
    "section",
    { "aria-labelledby": "stories-heading" },
    sectionHeader({
      id: "stories-heading",
      title: "Every recovery attempt",
      subtitle: "One row per missed appointment your AI team followed up on.",
    }),
    el(
      "div.card.card--flush",
      null,
      dataTable({
        caption: "Missed appointments, the follow-up sent, and the outcome",
        rows: stories,
        rowKey: (story) => story.id,
        empty: emptyState({
          iconName: "refresh",
          title: "No follow-ups sent yet",
          body: "When someone misses a visit, the message your Recovery agent sends and what happened next both appear here.",
        }),
        columns: [
          {
            key: "client",
            label: "Client",
            render: (story) =>
              el(
                "div.stack",
                { style: { gap: "1px" } },
                el("span.small", { text: story.subject }),
                el("span.table__secondary", { text: story.service })
              ),
          },
          {
            key: "missed",
            label: "What happened",
            render: (story) =>
              el(
                "div.stack",
                { style: { gap: "1px" } },
                el("span.small", {
                  text: story.missed_status === "no_show" ? "Did not attend" : "Cancelled",
                }),
                el("span.table__secondary", { text: fmt.dateOnly(story.missed_at) })
              ),
          },
          {
            key: "contacted",
            label: "Followed up",
            render: (story) =>
              el("span.small", { text: fmt.relative(story.contacted_at) }),
          },
          {
            key: "outcome",
            label: "Outcome",
            render: (story) =>
              story.recovered
                ? el(
                    "div.stack",
                    { style: { gap: "2px" } },
                    badge("Rebooked", "success", { dot: true }),
                    el("span.table__secondary", {
                      text: fmt.dateOnly(story.rebooked_for),
                    })
                  )
                : badge("No response yet", "neutral"),
          },
          {
            key: "value",
            label: "Value",
            width: "110px",
            render: (story) =>
              el("span.small.numeric", {
                text:
                  story.recovered && story.value_cents !== null
                    ? fmt.money(story.value_cents)
                    : fmt.EMPTY,
              }),
          },
        ],
      })
    )
  );
}
