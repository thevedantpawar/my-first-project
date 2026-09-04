/**
 * Opportunities — every recoverable moment the engine has found, in one place.
 */

import { el } from "../dom.js";
import * as fmt from "../format.js";
import { load} from "../store.js";
import {
  badge,
  button,
  emptyState,
  filterBar,
  keyValues,
  note,
  pageHeader,
  sectionHeader,
  skeletonCards,
  timeline as timelineList,
  skeletonLines,
} from "../ui/components.js";
import { icon } from "../icons.js";
import { openDrawer, setDrawerBody, closeDrawer } from "../ui/overlays.js";
import { navigate } from "../router.js";
import {
  renderAsync,
  opportunityCard,
  runOpportunityAction,
  emptyOpportunities,
  ACTIONS,
} from "./common.js";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "high_intent_lead", label: "High intent" },
  { value: "no_show", label: "No-shows" },
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "callback", label: "Needs your team" },
  { value: "dormant", label: "Dormant" },
  { value: "review", label: "Reviews" },
];

let activeFilter = "all";

export async function renderOpportunities(container) {
  const body = el("div");
  const filterSlot = el("div", { style: { marginBottom: "var(--space-5)" } });

  const summarySlot = el("div", { style: { marginBottom: "var(--space-6)" } });

  container.replaceChildren(
    pageHeader({
      eyebrow: "Revenue recovery",
      title: "Revenue opportunities",
      subtitle: "Business your AI team can help recover or convert, ranked by what is most worth your minute.",
    }),
    summarySlot,
    filterSlot,
    body
  );

  return renderAsync(
    body,
    () => load.opportunities(),
    (items) => {
      const counts = { all: items.length };
      items.forEach((item) => {
        counts[item.kind] = (counts[item.kind] || 0) + 1;
        if (item.kind === "warm_lead") counts.high_intent_lead = counts.high_intent_lead || 0;
      });

      filterSlot.replaceChildren(
        filterBar({
          options: FILTERS.filter((option) => option.value === "all" || counts[option.value]),
          active: activeFilter,
          counts,
          onChange: (value) => {
            activeFilter = value;
            renderOpportunities(container);
          },
        })
      );

      summarySlot.replaceChildren(prioritySummary(items));

      const visible =
        activeFilter === "all" ? items : items.filter((item) => item.kind === activeFilter);

      if (!visible.length) {
        return el(
          "div.card",
          null,
          items.length
            ? emptyState({
                iconName: "checkCircle",
                title: "Nothing in this category",
                body: "Try another filter — your other opportunities are still waiting.",
                actions: [
                  button({
                    label: "Show all",
                    variant: "secondary",
                    onClick: () => {
                      activeFilter = "all";
                      renderOpportunities(container);
                    },
                  }),
                ],
              })
            : emptyOpportunities()
        );
      }

      return el(
        "div.grid.grid--3",
        null,
        visible.map((item) =>
          opportunityCard(item, {
            onOpen: openOpportunity,
            onAct: (opportunity, action) =>
              runOpportunityAction(opportunity, action, { onDone: () => renderOpportunities(container) }),
          })
        )
      );
    },
    { skeleton: () => skeletonCards(3, { tall: true }), context: "Couldn't load your opportunities" }
  );
}

/**
 * A band above the list summarising what is waiting.
 *
 * Counts only. The engine records no monetary value against an opportunity,
 * so this does not print one — a "potential value" figure would be invented.
 */
function prioritySummary(items) {
  const urgent = items.filter((item) => item.tone === "urgent").length;
  const attention = items.filter((item) => item.tone === "attention").length;
  const rest = items.length - urgent - attention;

  if (!items.length) return el("div");

  const stat = (value, label, tone) =>
    el(
      "div.stack",
      { style: { gap: "2px", minWidth: 0 } },
      el(
        "span.row",
        { style: { gap: "var(--space-2)" } },
        el("span", {
          style: {
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: `var(--${tone})`,
            flex: "none",
          },
        }),
        el("span.metric__value", { style: { fontSize: "var(--text-2xl)" }, text: fmt.number(value) })
      ),
      el("span.xsmall.muted", { text: label })
    );

  return el(
    "div.panel",
    {
      style: {
        display: "flex",
        gap: "var(--space-8)",
        alignItems: "center",
        flexWrap: "wrap",
        padding: "var(--space-5) var(--space-6)",
      },
    },
    el(
      "div.stack",
      { style: { gap: "2px", flex: "1 1 240px", minWidth: 0 } },
      el("span.eyebrow", { text: "Waiting on a person" }),
      el("p.small.secondary", {
        text: `${fmt.pluralise(items.length, "opportunity", "opportunities")} your engine has surfaced and not been able to close on its own.`,
      })
    ),
    stat(urgent, "High priority", "danger"),
    stat(attention, "Medium", "warning"),
    stat(rest, "Low", "text-faint")
  );
}

/* -------------------------------------------------------------------------
   Detail drawer
   ------------------------------------------------------------------------- */
export function openOpportunity(item) {
  const action = ACTIONS[item.kind];

  openDrawer({
    title: item.subject,
    subtitle: `${item.kind_label} · ${item.detail}`,
    body: el("div", null, summarySection(item), el("div.stack", null, skeletonLines(4))),
    footer: [
      action
        ? button({
            label: action.label,
            variant: "primary",
            onClick: () =>
              runOpportunityAction(item, action, {
                onDone: () => closeDrawer(),
              }),
          })
        : null,
      item.record.type === "lead"
        ? button({
            label: "Open lead",
            variant: "secondary",
            trailingIcon: "arrowRight",
            onClick: () => {
              closeDrawer();
              navigate(`/leads/${item.record.id}`);
            },
          })
        : null,
      button({ label: "Close", variant: "ghost", onClick: closeDrawer }),
    ].filter(Boolean),
  });

  loadDetail(item);
}

function summarySection(item) {
  return el(
    "div.stack",
    null,
    el(
      "div.stack.stack--tight",
      null,
      el("p.eyebrow", { text: "What happened" }),
      el("p.small", { text: `${item.kind_label}. ${item.detail}.` }),
      item.waiting_hours
        ? el("p.xsmall.muted", { text: `Waiting ${fmt.relativeFromHours(item.waiting_hours)}.` })
        : null
    ),
    el(
      "div.stack.stack--tight",
      null,
      el("p.eyebrow", { text: "Why it matters" }),
      el("p.small", { text: item.why })
    ),
    el(
      "div.stack.stack--tight",
      null,
      el("p.eyebrow", { text: "Next best action" }),
      el("p.small", { style: { fontWeight: "var(--weight-medium)" }, text: item.next_action }),
      ACTIONS[item.kind]
        ? null
        : note(
            item.kind === "no_show"
              ? "Recovery messages for missed visits are sent by the no-show workflow, not from here. This card shows whether one has gone out."
              : "This one needs a person — the console has no automated action for it.",
            "neutral"
          )
    ),
    item.flags?.length
      ? el("div.row.row--wrap", { style: { gap: "var(--space-2)" } }, item.flags.map((flag) => badge(flag, "attention")))
      : null
  );
}

async function loadDetail(item) {
  const patientUuid = item.record.patient_uuid;
  let history = null;
  let error = null;

  if (patientUuid) {
    try {
      history = await load.timeline(patientUuid);
    } catch (cause) {
      error = cause;
    }
  }

  setDrawerBody(
    el(
      "div",
      null,
      summarySection(item),
      el(
        "div.stack.stack--tight",
        { style: { marginTop: "var(--space-6)" } },
        el("p.eyebrow", { text: "What your engine has already done" }),
        historyView(history, error, item)
      ),
      el(
        "details.disclosure",
        { style: { marginTop: "var(--space-6)" } },
        el("summary", { text: "Technical detail" }),
        el(
          "div.disclosure__body",
          null,
          keyValues([
            ["Record type", fmt.titleCase(item.record.type)],
            ["Record id", el("span.code", { text: item.record.id })],
            patientUuid ? ["Client id", el("span.code", { text: patientUuid })] : null,
            ["Opportunity kind", el("span.code", { text: item.kind })],
            item.score !== null && item.score !== undefined ? ["Lead score", String(item.score)] : null,
          ].filter(Boolean))
        )
      )
    )
  );
}

function historyView(history, error, item) {
  if (error) {
    return note("Couldn't load this client's history. The opportunity itself is unaffected.", "warn");
  }
  if (!history) {
    return note(
      item.record.type === "lead"
        ? "This is a new enquiry — it has no client record yet, so there is no history to show."
        : "No client record is linked to this item.",
      "neutral"
    );
  }
  if (!history.length) {
    return el("p.small.muted", { text: "Nothing has been sent to this client yet." });
  }
  return timelineList(
    history.slice(0, 8).map((event) => ({
      label: eventLabel(event.event_type),
      at: event.created_at,
      done: true,
    }))
  );
}

const EVENT_LABELS = {
  reminder_sent: "Reminder sent",
  final_reminder_sent: "Final reminder sent",
  no_show: "Marked as missed",
  reactivation_sent: "Recovery message sent",
  credit_offer_sent: "Rebooking credit offered",
  review_requested: "Review requested",
  review_received: "Review received",
  review_response_drafted: "Reply drafted",
  treatment_completed: "Treatment completed",
  rebooked: "Rebooked",
  nurture_sent: "Follow-up message sent",
};

export function eventLabel(type) {
  return EVENT_LABELS[type] || fmt.sentence(type);
}
