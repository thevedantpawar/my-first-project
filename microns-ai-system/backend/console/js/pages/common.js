/**
 * Shared page machinery: async rendering with real loading/error states, the
 * opportunity card, and the action handlers.
 *
 * Every action in this file routes to an endpoint that already existed and is
 * already audited. The console adds a confirmation step in front of anything
 * that would text a real person.
 */

import { el, mount } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { api, ApiError } from "../api.js";
import { invalidate, state } from "../store.js";
import {
  badge,
  button,
  emptyState,
  errorState,
  loadingRegion,
  modeBadge,
  note,
  skeletonCards,
} from "../ui/components.js";
import { confirmAction, toast, closeDrawer } from "../ui/overlays.js";

/**
 * Renders a region that loads its own data.
 *
 * Guarantees a skeleton first (never a blank screen), an explanatory error
 * state on failure, and a re-render when the operator retries.
 */
export async function renderAsync(target, loader, render, { skeleton, context } = {}) {
  mount(target, skeleton ? skeleton() : loadingRegion());
  try {
    const data = await loader();
    mount(target, render(data));
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (error instanceof ApiError && error.isAuth) {
      window.dispatchEvent(new CustomEvent("microns:unauthorised"));
      return;
    }
    mount(
      target,
      el(
        "div.card",
        null,
        errorState({
          error,
          context,
          onRetry: () => renderAsync(target, loader, render, { skeleton, context }),
        })
      )
    );
  }
}

/* -------------------------------------------------------------------------
   Opportunity card — the shape used on both the dashboard and the
   Opportunities page, so the two never drift apart.
   ------------------------------------------------------------------------- */
const TONE_BADGE = { urgent: "critical", attention: "attention", info: "info" };
const PRIORITY = {
  urgent: { label: "High priority", tone: "critical" },
  attention: { label: "Medium", tone: "attention" },
  info: { label: "Low", tone: "neutral" },
};

const KIND_ICONS = {
  high_intent_lead: "sparkle",
  warm_lead: "leads",
  no_show: "refresh",
  dormant: "clock",
  review: "star",
  callback: "phone",
  unconfirmed: "calendar",
};

/**
 * The opportunity card, used on both the dashboard and the Opportunities
 * page so the two never drift apart.
 *
 * Priority is carried by a word and an icon as well as a colour — a card that
 * only signals urgency in red is unreadable to a good share of owners.
 */
export function opportunityCard(item, { onOpen, onAct, compact = false } = {}) {
  const priority = PRIORITY[item.tone] || PRIORITY.info;
  const waiting = item.waiting_hours ? fmt.relativeFromHours(item.waiting_hours) : null;

  return el(
    "article.card",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "var(--space-5)",
      },
    },
    el(
      "div.row.row--between",
      { style: { alignItems: "flex-start", gap: "var(--space-3)" } },
      el(
        "div.row",
        { style: { gap: "var(--space-3)", minWidth: 0, alignItems: "flex-start" } },
        el(
          "span",
          {
            style: {
              width: "34px",
              height: "34px",
              borderRadius: "var(--radius-sm)",
              background: `var(--${priority.tone === "critical" ? "danger" : priority.tone === "attention" ? "warning" : "neutral"}-bg)`,
              color: `var(--${priority.tone === "critical" ? "danger" : priority.tone === "attention" ? "warning" : "text-muted"})`,
              display: "grid",
              placeItems: "center",
              flex: "none",
            },
          },
          icon(KIND_ICONS[item.kind] || "opportunity", 17)
        ),
        el(
          "div.stack",
          { style: { gap: "2px", minWidth: 0 } },
          el("span.eyebrow", { text: item.kind_label }),
          el("p.card-title", { text: item.subject }),
          el("p.small.muted", { text: item.detail })
        )
      ),
      el(
        "div.stack",
        { style: { gap: "var(--space-2)", alignItems: "flex-end", flex: "none" } },
        badge(priority.label, priority.tone),
        waiting ? el("span.xsmall.muted", { style: { whiteSpace: "nowrap" }, text: waiting }) : null
      )
    ),
    compact ? null : el("p.xsmall.muted", { text: item.why }),
    (item.flags || []).length
      ? el("div.row.row--wrap", { style: { gap: "var(--space-2)" } }, item.flags.map((flag) => badge(flag, "neutral")))
      : null,
    el(
      "div",
      {
        style: {
          borderTop: "1px solid var(--border-subtle)",
          paddingTop: "var(--space-4)",
          marginTop: "auto",
          display: "flex",
          gap: "var(--space-3)",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        },
      },
      el(
        "div.stack",
        { style: { gap: "2px", minWidth: 0 } },
        el("span.eyebrow", { text: "Next best action" }),
        el("span.small", { style: { fontWeight: "var(--weight-medium)" }, text: item.next_action })
      ),
      el(
        "div.row",
        { style: { gap: "var(--space-2)" } },
        onOpen ? button({ label: "View", variant: "secondary", size: "sm", onClick: () => onOpen(item) }) : null,
        actionButton(item, onAct)
      )
    )
  );
}

function actionButton(item, onAct) {
  const action = ACTIONS[item.kind];
  if (!action || !onAct) return null;
  return button({
    label: action.label,
    variant: "primary",
    size: "sm",
    onClick: () => onAct(item, action),
  });
}

/**
 * The actions the console can actually perform, each mapped to an existing
 * endpoint. A kind with no entry here gets a "View" button and nothing else —
 * the console never shows a button that does not do something real.
 */
export const ACTIONS = {
  // No-show recovery is deliberately absent. The engine sends that message
  // from the no-show workflow with its own template and idempotency guard;
  // there is no staff-facing endpoint for it, and firing the dormant-client
  // reactivation instead would send the wrong message. The card shows what
  // the Recovery Specialist has already done and leaves it there.
  dormant: {
    label: "Send offer",
    confirm: (item) => ({
      title: "Send a reactivation offer?",
      body: `This texts ${item.subject} a reactivation offer. There is a 30-day cooldown per client. ${deliveryCaveat()}`,
      confirmLabel: "Send offer",
    }),
    run: (item) => api.reactivatePatient(item.record.patient_uuid || item.record.id),
  },
  review: {
    label: "Request review",
    confirm: (item) => ({
      title: "Ask for a review?",
      body: `This texts ${item.subject} a review request. ${deliveryCaveat()}`,
      confirmLabel: "Send request",
    }),
    run: (item) => api.triggerReview(item.record.id),
  },
  unconfirmed: {
    label: "Confirm",
    confirm: (item) => ({
      title: "Confirm this appointment?",
      body: `This marks ${item.subject}'s appointment as confirmed on the calendar.`,
      confirmLabel: "Confirm booking",
    }),
    run: (item) => api.updateAppointmentStatus(item.record.id, "confirmed"),
  },
};

/** Says out loud whether a message will actually be delivered. */
function deliveryCaveat() {
  const sms = state.system?.integrations?.find((integration) => integration.id === "sms");
  if (!sms) return "";
  return sms.connected
    ? "It will be delivered by text message."
    : "Text messaging is not connected, so the message will be composed and audited but not delivered.";
}

export async function runOpportunityAction(item, action, { onDone } = {}) {
  const confirmed = await confirmAction(action.confirm(item));
  if (!confirmed) return;

  try {
    const result = await action.run(item);
    invalidate();
    const skipped = result?.status === "skipped";
    toast({
      title: skipped ? "No message sent" : "Done",
      body: skipped
        ? humanSkipReason(result)
        : deliveryCaveat().startsWith("Text messaging is not connected")
          ? "Recorded and audited. Not delivered — text messaging is not connected."
          : "The message is on its way.",
      variant: skipped ? "warning" : "success",
    });
    if (onDone) onDone(result);
  } catch (error) {
    toast({
      title: "That didn't work",
      body: error.message,
      variant: "error",
      timeout: 8000,
    });
  }
}

function humanSkipReason(result) {
  const reason = result?.detail || result?.data?.reason;
  const map = {
    already_sent: "This message has already gone out.",
    cooldown: "This client was contacted recently — the 30-day cooldown is still running.",
    no_marketing_consent: "This client has not consented to marketing messages.",
    no_consent: "This client has not consented to messages.",
    appointment_cancelled: "The appointment is cancelled.",
  };
  return map[reason] || "The engine declined this — nothing was sent.";
}

/* -------------------------------------------------------------------------
   Small shared pieces
   ------------------------------------------------------------------------- */
export function emptyOpportunities() {
  return emptyState({
    iconName: "checkCircle",
    title: "Nothing needs you right now",
    body: "Your AI team has not surfaced any recoverable opportunities. That's a good sign — it means nothing is sitting unanswered.",
    actions: [button({ label: "See activity", variant: "secondary", href: "#/conversations" })],
  });
}

/** A short, honest caption for a number the engine only partly observes. */
export function coverageNote(coverage) {
  if (!coverage || !coverage.appointments) return null;
  if (coverage.complete) return null;
  const missing = coverage.appointments - coverage.with_recorded_price;
  return note(
    `${fmt.number(coverage.with_recorded_price)} of ${fmt.number(coverage.appointments)} appointments have a recorded price. ` +
      `${fmt.number(missing)} have none, so they are counted but contribute nothing to the totals below.`,
    "neutral"
  );
}

export function windowLabel() {
  return `Last ${state.windowDays} days`;
}

export { skeletonCards, modeBadge, closeDrawer };
