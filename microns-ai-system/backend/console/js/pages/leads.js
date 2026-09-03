/**
 * Leads list and lead detail.
 *
 * The list is a working table, not a database dump: name, what they want,
 * how interested they are, and what to do next. Everything else lives in the
 * detail view.
 */

import { el } from "../dom.js";
import * as fmt from "../format.js";
import { load } from "../store.js";
import {
  badge,
  button,
  cellPerson,
  dataTable,
  emptyState,
  filterBar,
  keyValues,
  note,
  pageHeader,
  progressBar,
  sectionHeader,
  skeletonLines,
  timeline as timelineList,
} from "../ui/components.js";
import { navigate } from "../router.js";
import { renderAsync } from "./common.js";
import { setBreadcrumb } from "../shell.js";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "hot", label: "High intent" },
  { value: "warm", label: "Medium intent" },
  { value: "cold", label: "Low intent" },
  { value: "status:qualified", label: "Qualified" },
  { value: "status:booked", label: "Booked" },
  { value: "status:nurture", label: "Nurture" },
  { value: "status:disqualified", label: "Not eligible" },
];

let activeFilter = "all";

export async function renderLeads(container) {
  const body = el("div");
  const filterSlot = el("div", { style: { marginBottom: "var(--space-5)" } });

  container.replaceChildren(
    pageHeader({
      eyebrow: "Pipeline",
      title: "Leads",
      subtitle: "Everyone who has enquired, scored and routed by your Lead Concierge.",
    }),
    filterSlot,
    body
  );

  filterSlot.replaceChildren(
    filterBar({
      options: FILTERS,
      active: activeFilter,
      onChange: (value) => {
        activeFilter = value;
        renderLeads(container);
      },
    })
  );

  const params = {};
  if (activeFilter.startsWith("status:")) params.status = activeFilter.split(":")[1];
  else if (activeFilter !== "all") params.temperature = activeFilter;

  return renderAsync(
    body,
    () => load.leads(params),
    (leads) =>
      el(
        "div.card.card--flush",
        null,
        dataTable({
          caption: "Leads with their intent, score and recommended next action",
          rows: leads,
          rowKey: (lead) => lead.display_name,
          onRowClick: (lead) => navigate(`/leads/${lead.lead_id}`),
          empty: emptyState({
            iconName: "leads",
            title: "No leads in this view",
            body:
              activeFilter === "all"
                ? "When someone chats on your website or texts your clinic, the Lead Concierge qualifies them and they appear here."
                : "No leads match this filter yet.",
            actions: [
              button({
                label: "Try the qualification engine",
                variant: "secondary",
                href: "#/test-center",
              }),
            ],
          }),
          columns: [
            {
              key: "name",
              label: "Client",
              render: (lead) => cellPerson(lead.display_name, lead.masked_phone || lead.source_label),
            },
            {
              key: "interest",
              label: "Interested in",
              render: (lead) =>
                el(
                  "div",
                  null,
                  el("div.small", { text: lead.treatment_label }),
                  el("div.table__secondary", { text: fmt.budget(lead.budget_range) })
                ),
            },
            {
              key: "intent",
              label: "Intent",
              render: (lead) =>
                lead.temperature
                  ? badge(fmt.temperatureLabel(lead.temperature), fmt.temperatureTone(lead.temperature), {
                      dot: true,
                    })
                  : el("span.table__secondary", { text: "Not scored yet" }),
            },
            {
              key: "score",
              label: "Score",
              width: "120px",
              render: (lead) =>
                el(
                  "div.stack",
                  { style: { gap: "var(--space-1)", minWidth: "84px" } },
                  el("span.small.numeric", { text: `${lead.score}/100` }),
                  progressBar(lead.score, 100, { tone: scoreTone(lead.score) })
                ),
            },
            {
              key: "stage",
              label: "Stage",
              render: (lead) => badge(fmt.statusLabel(lead.status), fmt.statusTone(lead.status)),
            },
            {
              key: "action",
              label: "Next best action",
              render: (lead) =>
                el(
                  "div",
                  null,
                  el("div.small", { text: lead.next_action }),
                  el("div.table__secondary", { text: fmt.relative(lead.created_at) })
                ),
            },
          ],
        })
      ),
    {
      skeleton: () => el("div.card", null, skeletonLines(8)),
      context: "Couldn't load your leads",
    }
  );
}

/* One data colour. The number beside the bar already carries the value, so a
   three-colour bar adds a second encoding of the same thing. */
function scoreTone() {
  return "accent";
}

/* -------------------------------------------------------------------------
   Lead detail
   ------------------------------------------------------------------------- */
export async function renderLeadDetail(container, { id }) {
  setBreadcrumb("Lead", { path: "/leads", label: "Leads" });

  return renderAsync(
    container,
    () => load.lead(id),
    (lead) =>
      el(
        "div",
        null,
        pageHeader({
          eyebrow: "Lead",
          title: lead.display_name,
          subtitle: `${lead.treatment_label} · enquired ${fmt.relative(lead.created_at)} via ${lead.source_label}`,
          actions: [
            button({ label: "Back to leads", variant: "ghost", href: "#/leads" }),
            lead.booking_url
              ? button({
                  label: "Open booking link",
                  variant: "primary",
                  href: lead.booking_url,
                  trailingIcon: "arrowRight",
                })
              : null,
          ].filter(Boolean),
        }),
        el(
          "div.grid.grid--sidebar",
          null,
          el("div.stack.stack--loose", null, scoreCard(lead), journeyCard(lead), activityCard(lead)),
          el("div.stack.stack--loose", null, profileCard(lead), answersCard(lead), advancedCard(lead))
        )
      ),
    { skeleton: () => el("div.card", null, skeletonLines(10)), context: "Couldn't load this lead" }
  );
}

function scoreCard(lead) {
  const breakdown = Object.entries(lead.score_breakdown || {}).filter(
    ([, value]) => typeof value === "number"
  );

  return el(
    "section.card",
    null,
    el(
      "div.row.row--between.row--wrap",
      { style: { gap: "var(--space-5)", alignItems: "flex-start" } },
      el(
        "div.stack.stack--tight",
        null,
        el("span.eyebrow", { text: "Qualification score" }),
        el(
          "div.row",
          { style: { gap: "var(--space-3)", alignItems: "baseline" } },
          el("span.hero__value", { style: { fontSize: "var(--text-3xl)" }, text: `${lead.score}` }),
          el("span.muted", { text: "/ 100" }),
          lead.temperature
            ? badge(fmt.temperatureLabel(lead.temperature), fmt.temperatureTone(lead.temperature), { dot: true })
            : null
        ),
        el("p.small.secondary", { style: { maxWidth: "48ch" }, text: lead.next_action })
      ),
      el(
        "div.stack.stack--tight",
        { style: { minWidth: "200px" } },
        el("span.eyebrow", { text: "Answered" }),
        el("span.metric__value", { text: `${lead.answered_questions} of 6` }),
        progressBar(lead.answered_questions, 6)
      )
    ),
    lead.needs_provider_approval || lead.medical_callback_required
      ? el(
          "div.stack.stack--tight",
          { style: { marginTop: "var(--space-5)" } },
          lead.medical_callback_required
            ? note(
                "Flagged for a provider callback. The engine will not book this lead until a clinician has spoken to them.",
                "warn"
              )
            : null,
          lead.needs_provider_approval
            ? note(
                "Blood thinners were mentioned. This changes who signs the treatment off — it does not change the score.",
                "warn"
              )
            : null
        )
      : null,
    breakdown.length
      ? el(
          "details.disclosure",
          { style: { marginTop: "var(--space-5)" } },
          el("summary", { text: "How this score was calculated" }),
          el(
            "div.disclosure__body",
            null,
            keyValues(breakdown.map(([key, value]) => [fmt.titleCase(key), `${value} points`]))
          )
        )
      : null
  );
}

function journeyCard(lead) {
  return el(
    "section.card",
    null,
    sectionHeader({ ruled: true, title: "Customer journey" }),
    timelineList(lead.journey || [])
  );
}

function activityCard(lead) {
  const conversation = lead.conversation || {};
  return el(
    "section.card",
    null,
    sectionHeader({
      ruled: true,
      title: "Conversation",
      subtitle: conversation.currently_asking || "Qualification complete",
    }),
    el(
      "div.stack",
      null,
      keyValues([
        ["Turns exchanged", fmt.number(conversation.turns || 0)],
        ["Last reply", conversation.last_reply_at ? fmt.dateTime(conversation.last_reply_at) : fmt.EMPTY],
        [
          "Finished",
          conversation.completed_at ? fmt.dateTime(conversation.completed_at) : "Still in progress",
        ],
      ]),
      note(
        "Message text is not stored. The engine keeps the answers and the qualification state, and discards the wording — so there is no transcript to show here.",
        "neutral"
      )
    ),
    (lead.events || []).length
      ? el(
          "div",
          { style: { marginTop: "var(--space-5)" } },
          el("p.eyebrow", { style: { marginBottom: "var(--space-3)" }, text: "Messages sent" }),
          timelineList(
            lead.events.map((event) => ({ label: event.label, at: event.created_at, done: true }))
          )
        )
      : null
  );
}

function profileCard(lead) {
  return el(
    "section.card",
    null,
    sectionHeader({ ruled: true, title: "Client" }),
    keyValues([
      ["Name", lead.display_name],
      ["Phone", lead.masked_phone || "Not provided"],
      ["Came from", lead.source_label],
      ["Stage", badge(fmt.statusLabel(lead.status), fmt.statusTone(lead.status))],
      ["First contact", fmt.dateTime(lead.created_at)],
      ["Qualified", lead.qualified_at ? fmt.dateTime(lead.qualified_at) : "Not yet"],
    ]),
    note(
      "Names are shown as a first name and last initial, and phone numbers as the last four digits. The full details stay encrypted.",
      "neutral"
    )
  );
}

function answersCard(lead) {
  const answers = lead.answers || {};
  const yesNo = (value) => (value === null || value === undefined ? fmt.EMPTY : value ? "Yes" : "No");

  return el(
    "section.card",
    null,
    sectionHeader({ ruled: true, title: "What they told us" }),
    keyValues([
      ["Treatment", lead.treatment_label],
      ["Had it before", yesNo(answers.previous_experience)],
      ["Pregnant / breastfeeding", yesNo(answers.is_pregnant)],
      ["Blood thinners", yesNo(answers.blood_thinner)],
      ["Budget", fmt.budget(answers.budget_range)],
      ["Timing", fmt.timeline(answers.timeline)],
    ])
  );
}

function advancedCard(lead) {
  return el(
    "details.disclosure",
    null,
    el("summary", { text: "Advanced" }),
    el(
      "div.disclosure__body",
      null,
      keyValues([
        ["Lead id", el("span.code", { text: lead.lead_id })],
        ["Source", el("span.code", { text: lead.source })],
        ["Status", el("span.code", { text: lead.status })],
        ["Temperature", el("span.code", { text: lead.temperature || "null" })],
        ["Provider approval", String(lead.needs_provider_approval)],
        ["Medical callback", String(lead.medical_callback_required)],
      ])
    )
  );
}
