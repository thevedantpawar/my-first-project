/**
 * Appointments — today, this week, and everything that needs confirming.
 */

import { el } from "../dom.js";
import * as fmt from "../format.js";
import { load, invalidate } from "../store.js";
import { api } from "../api.js";
import {
  badge,
  button,
  dataTable,
  emptyState,
  filterBar,
  keyValues,
  metricCard,
  note,
  pageHeader,
  skeletonLines,
  timeline as timelineList,
} from "../ui/components.js";
import { openDrawer, setDrawerBody, closeDrawer, confirmAction, toast } from "../ui/overlays.js";
import { renderAsync } from "./common.js";

const VIEWS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
  { value: "pending", label: "Needs confirming" },
  { value: "missed", label: "Missed" },
  { value: "all", label: "All recent" },
];

let activeView = "today";

export async function renderAppointments(container) {
  const body = el("div");
  const filterSlot = el("div", { style: { marginBottom: "var(--space-5)" } });

  container.replaceChildren(
    pageHeader({
      eyebrow: "Calendar",
      title: "Appointments",
      subtitle: "Who is coming in, who booked them, and what still needs confirming.",
    }),
    filterSlot,
    body
  );

  filterSlot.replaceChildren(
    filterBar({
      options: VIEWS,
      active: activeView,
      onChange: (value) => {
        activeView = value;
        renderAppointments(container);
      },
    })
  );

  return renderAsync(
    body,
    () => load.appointments({ limit: 200 }),
    (rows) => {
      const visible = rows.filter(inView);
      return el(
        "div.stack.stack--loose",
        null,
        summaryRow(rows),
        el(
          "div.card.card--flush",
          null,
          dataTable({
            caption: "Appointments with their status and booking source",
            rows: visible,
            rowKey: (row) => `${row.service} appointment`,
            onRowClick: (row) => openAppointment(row, container),
            empty: emptyState({
              iconName: "calendar",
              title: emptyTitle(),
              body: emptyBody(),
              actions: [
                button({
                  label: "See all recent",
                  variant: "secondary",
                  onClick: () => {
                    activeView = "all";
                    renderAppointments(container);
                  },
                }),
              ],
            }),
            columns: [
              {
                key: "when",
                label: "When",
                render: (row) =>
                  el(
                    "div",
                    null,
                    el("div.small", {
                      style: { fontWeight: "var(--weight-semibold)" },
                      text: fmt.timeOnly(row.scheduled_for),
                    }),
                    el("div.table__secondary", { text: fmt.dateOnly(row.scheduled_for) })
                  ),
              },
              {
                key: "service",
                label: "Treatment",
                render: (row) =>
                  el(
                    "div",
                    null,
                    el("div.small", { text: fmt.titleCase(row.service) }),
                    el("div.table__secondary", { text: `${row.duration_minutes} min` })
                  ),
              },
              {
                key: "provider",
                label: "Provider",
                render: (row) =>
                  el("span.small", { text: row.provider || "Not assigned" }),
              },
              {
                key: "source",
                label: "Booked by",
                render: (row) => sourceBadge(row.source),
              },
              {
                key: "status",
                label: "Status",
                render: (row) => badge(fmt.statusLabel(row.status), fmt.statusTone(row.status), { dot: true }),
              },
            ],
          })
        ),
        note(
          "Client names are not shown in the calendar list. Open an appointment to see the masked name and its history.",
          "neutral"
        )
      );
    },
    { skeleton: () => el("div.card", null, skeletonLines(8)), context: "Couldn't load the calendar" }
  );
}

function inView(row) {
  const date = fmt.parseDate(row.scheduled_for);
  if (!date) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000);

  switch (activeView) {
    case "today":
      return date >= startOfToday && date < endOfToday;
    case "week":
      return date >= startOfToday && date < new Date(startOfToday.getTime() + 7 * 86_400_000);
    case "pending":
      return row.status === "pending";
    case "missed":
      return row.status === "no_show";
    default:
      return true;
  }
}

function emptyTitle() {
  return {
    today: "Nothing booked for today",
    week: "Nothing booked this week",
    pending: "Everything is confirmed",
    missed: "No missed appointments",
    all: "No appointments yet",
  }[activeView];
}

function emptyBody() {
  return {
    today: "Your calendar is clear. Appointments booked by phone, chat or your front desk all appear here.",
    week: "Nothing on the books for the next seven days.",
    pending: "Every booking has been confirmed by your team.",
    missed: "Nobody has missed a visit in this period — that is the number you want at zero.",
    all: "When the AI Receptionist or your team books someone, it shows up here.",
  }[activeView];
}

/** Booking source, stated as fact. "AI booked" only when the row says so. */
function sourceBadge(source) {
  const map = {
    voice: ["AI booked · phone", "accent"],
    web: ["AI booked · chat", "accent"],
    sms: ["AI booked · text", "accent"],
    staff: ["Front desk", "neutral"],
    booking_system: ["Practice calendar", "info"],
  };
  const [label, tone] = map[source] || [fmt.titleCase(source), "neutral"];
  return badge(label, tone);
}

function summaryRow(rows) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = rows.filter((row) => {
    const date = fmt.parseDate(row.scheduled_for);
    return date && date >= startOfToday && date < new Date(startOfToday.getTime() + 86_400_000);
  });
  const pending = rows.filter((row) => row.status === "pending");
  const missed = rows.filter((row) => row.status === "no_show");
  const aiBooked = rows.filter((row) => ["voice", "web", "sms"].includes(row.source));

  return el(
    "div.grid.grid--4",
    null,
    metricCard({ label: "Today", value: fmt.number(today.length), foot: "appointments scheduled" }),
    metricCard({
      label: "Awaiting confirmation",
      value: fmt.number(pending.length),
      foot: "held by the phone agent",
    }),
    metricCard({ label: "Missed", value: fmt.number(missed.length), foot: "in this list" }),
    metricCard({
      label: "Booked by your AI",
      value: fmt.number(aiBooked.length),
      foot: `of ${fmt.number(rows.length)} appointments`,
    })
  );
}

/* -------------------------------------------------------------------------
   Appointment drawer
   ------------------------------------------------------------------------- */
function openAppointment(row, container) {
  openDrawer({
    title: fmt.titleCase(row.service),
    subtitle: `${fmt.dateOnly(row.scheduled_for)} at ${fmt.timeOnly(row.scheduled_for)}`,
    body: appointmentBody(row, null),
    footer: footerActions(row, container),
  });

  load
    .timeline(row.patient_uuid)
    .then((history) => setDrawerBody(appointmentBody(row, history)))
    .catch(() => setDrawerBody(appointmentBody(row, [])));
}

function appointmentBody(row, history) {
  return el(
    "div.stack.stack--loose",
    null,
    el(
      "div",
      null,
      keyValues([
        ["Status", badge(fmt.statusLabel(row.status), fmt.statusTone(row.status), { dot: true })],
        ["Treatment", fmt.titleCase(row.service)],
        ["Length", `${row.duration_minutes} minutes`],
        ["Provider", row.provider || "Not assigned"],
        ["Booked by", sourceBadge(row.source)],
        ["When", `${fmt.dateOnly(row.scheduled_for)} · ${fmt.timeOnly(row.scheduled_for)}`],
      ])
    ),
    el(
      "div.stack.stack--tight",
      null,
      el("p.eyebrow", { text: "What your engine has done" }),
      history === null
        ? el("div.skeleton", { style: { height: "60px" } })
        : history.length
          ? timelineList(
              history.slice(0, 10).map((event) => ({
                label: fmt.sentence(event.event_type),
                at: event.created_at,
                done: true,
              }))
            )
          : el("p.small.muted", { text: "No reminders or follow-ups have been sent for this client yet." })
    ),
    el(
      "details.disclosure",
      null,
      el("summary", { text: "Technical detail" }),
      el(
        "div.disclosure__body",
        null,
        keyValues([
          ["Appointment id", el("span.code", { text: row.appointment_id })],
          ["Client id", el("span.code", { text: row.patient_uuid })],
          ["Source", el("span.code", { text: row.source })],
          ["Status", el("span.code", { text: row.status })],
        ])
      )
    )
  );
}

function footerActions(row, container) {
  const transitions = [];
  if (row.status === "pending") transitions.push(["confirmed", "Confirm", "primary"]);
  if (["pending", "confirmed"].includes(row.status)) {
    transitions.push(["completed", "Mark completed", "secondary"]);
    transitions.push(["no_show", "Mark missed", "danger"]);
  }

  return transitions.map(([status, label, variant]) =>
    button({
      label,
      variant,
      onClick: async () => {
        const confirmed = await confirmAction({
          title: `${label}?`,
          body: statusCaveat(status),
          confirmLabel: label,
          variant: variant === "danger" ? "danger" : "primary",
        });
        if (!confirmed) return;
        try {
          await api.updateAppointmentStatus(row.appointment_id, status);
          invalidate();
          toast({ title: "Appointment updated", variant: "success" });
          closeDrawer();
          renderAppointments(container);
        } catch (error) {
          toast({ title: "Couldn't update it", body: error.message, variant: "error" });
        }
      },
    })
  );
}

function statusCaveat(status) {
  if (status === "completed")
    return "This opens the review window — your Review Assistant will ask this client for a review once the delay has passed.";
  if (status === "no_show")
    return "This starts no-show recovery. The Recovery Specialist will reach out about rebooking.";
  return "This marks the booking as confirmed on your calendar.";
}
