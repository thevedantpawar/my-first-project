/**
 * Conversations — chat, SMS and phone in one command centre.
 *
 * A note on the layout. The usual inbox is three panels: list, thread,
 * context. This engine deliberately does not retain message text — chat and
 * SMS keep only the qualification state, and call transcripts are encrypted
 * PHI that no dashboard should decrypt. So the middle panel would be
 * permanently empty, and an empty panel that looks like a thread is worse
 * than no panel at all. What is shown instead is everything the engine does
 * know: who, through which channel, how far the conversation got, who is
 * handling it, and what to do next.
 */

import { el } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { load } from "../store.js";
import {
  avatar,
  badge,
  button,
  emptyState,
  filterBar,
  keyValues,
  note,
  pageHeader,
  sectionHeader,
  skeletonLines,
} from "../ui/components.js";
import { navigate } from "../router.js";
import { renderAsync } from "./common.js";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "needs_human", label: "Needs your team" },
  { value: "ai", label: "AI handling" },
  { value: "call", label: "Phone" },
  { value: "chat", label: "Website chat" },
];

let activeFilter = "all";
let selectedId = null;

export async function renderConversations(container) {
  const layout = el("div");
  const filterSlot = el("div", { style: { marginBottom: "var(--space-5)" } });

  container.replaceChildren(
    pageHeader({
      eyebrow: "Front desk",
      title: "Conversations",
      subtitle: "Every enquiry your AI team has handled, across chat, text and phone.",
    }),
    filterSlot,
    layout
  );

  filterSlot.replaceChildren(
    filterBar({
      options: FILTERS,
      active: activeFilter,
      onChange: (value) => {
        activeFilter = value;
        renderConversations(container);
      },
    })
  );

  return renderAsync(
    layout,
    () => load.conversations(),
    (rows) => {
      const visible = rows.filter(matchesFilter);
      if (!visible.length) {
        return el(
          "div.card",
          null,
          emptyState({
            iconName: "inbox",
            title: rows.length ? "Nothing in this view" : "No conversations yet",
            body: rows.length
              ? "Try another filter."
              : "When someone chats on your website, texts your clinic or calls, the conversation appears here.",
            actions: rows.length
              ? [
                  button({
                    label: "Show all",
                    variant: "secondary",
                    onClick: () => {
                      activeFilter = "all";
                      renderConversations(container);
                    },
                  }),
                ]
              : [button({ label: "Try the AI", variant: "secondary", href: "#/test-center" })],
          })
        );
      }

      if (!visible.some((row) => row.id === selectedId)) selectedId = visible[0].id;

      const detailSlot = el("div");
      const list = el(
        "div.card.card--flush",
        { style: { overflow: "hidden" } },
        el(
          "ul",
          { role: "list", style: { maxHeight: "70vh", overflowY: "auto" } },
          visible.map((row) => conversationRow(row, detailSlot, container))
        )
      );

      renderDetail(detailSlot, visible.find((row) => row.id === selectedId));

      return el(
        "div.grid",
        { style: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.05fr)", alignItems: "start", gap: "var(--space-5)" }, class: "conversations" },
        list,
        detailSlot
      );
    },
    { skeleton: () => el("div.card", null, skeletonLines(8)), context: "Couldn't load conversations" }
  );
}

function matchesFilter(row) {
  if (activeFilter === "all") return true;
  if (activeFilter === "needs_human") return row.handling === "needs_human";
  if (activeFilter === "ai") return row.handling === "ai";
  if (activeFilter === "call") return row.type === "call";
  if (activeFilter === "chat") return row.type !== "call";
  return true;
}

function conversationRow(row, detailSlot, container) {
  const selected = row.id === selectedId;

  return el(
    "li",
    null,
    el(
      "button",
      {
        type: "button",
        "aria-current": selected ? "true" : null,
        style: {
          width: "100%",
          textAlign: "left",
          display: "flex",
          gap: "var(--space-3)",
          padding: "var(--space-4)",
          borderBottom: "1px solid var(--line-faint)",
          background: selected ? "var(--accent-50)" : "transparent",
          borderLeft: `2px solid ${selected ? "var(--accent)" : "transparent"}`,
        },
        onClick: () => {
          selectedId = row.id;
          renderConversations(container);
        },
      },
      avatar(row.subject, { size: "sm" }),
      el(
        "span",
        { style: { flex: 1, minWidth: 0 } },
        el(
          "span.row.row--between",
          { style: { gap: "var(--space-2)" } },
          el("span.small", { style: { fontWeight: "var(--weight-semibold)" }, text: row.subject }),
          el("span.xsmall.muted", { style: { whiteSpace: "nowrap" }, text: fmt.relative(row.updated_at) })
        ),
        el("span.xsmall.muted", {
          style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
          text: row.preview || row.intent,
        }),
        el(
          "span.row",
          { style: { gap: "var(--space-2)", marginTop: "var(--space-2)", flexWrap: "wrap" } },
          channelBadge(row),
          handlingBadge(row.handling),
          row.temperature
            ? badge(fmt.temperatureLabel(row.temperature), fmt.temperatureTone(row.temperature))
            : null
        )
      )
    )
  );
}

function channelBadge(row) {
  const map = { call: "phone", sms: "message", chat: "inbox" };
  return el(
    "span.badge.badge--neutral",
    null,
    icon(map[row.type] || "message", 11),
    el("span", { text: row.channel })
  );
}

/** Who is on this conversation — never hidden, never ambiguous. */
function handlingBadge(handling) {
  if (handling === "needs_human") return badge("Needs your team", "critical", { dot: true });
  if (handling === "closed") return badge("Closed", "neutral", { dot: true });
  return badge("AI handling", "accent", { dot: true });
}

/* -------------------------------------------------------------------------
   Context panel
   ------------------------------------------------------------------------- */
function renderDetail(target, row) {
  if (!row) {
    target.replaceChildren(el("div.card", null, emptyState({ title: "Select a conversation" })));
    return;
  }

  target.replaceChildren(
    el(
      "div.stack",
      null,
      el(
        "section.card",
        null,
        el(
          "div.row.row--between.row--wrap",
          { style: { alignItems: "flex-start", gap: "var(--space-4)" } },
          el(
            "div.row",
            { style: { gap: "var(--space-3)", minWidth: 0 } },
            avatar(row.subject, { size: "lg" }),
            el(
              "div.stack",
              { style: { gap: "2px", minWidth: 0 } },
              el("h2.card-title", { text: row.subject }),
              el("p.small.muted", { text: `${row.channel} · ${row.intent}` })
            )
          ),
          el("div.row", { style: { gap: "var(--space-2)" } }, handlingBadge(row.handling))
        ),
        el(
          "div",
          { style: { marginTop: "var(--space-5)" } },
          keyValues(
            [
              ["Status", badge(fmt.statusLabel(row.status), fmt.statusTone(row.status))],
              row.masked_phone ? ["Phone", row.masked_phone] : null,
              row.score !== null && row.score !== undefined ? ["Lead score", `${row.score}/100`] : null,
              row.turns !== null && row.turns !== undefined ? ["Turns", fmt.number(row.turns)] : null,
              row.duration_seconds !== undefined && row.duration_seconds !== null
                ? ["Call length", fmt.duration(row.duration_seconds)]
                : null,
              ["Last activity", fmt.dateTime(row.updated_at)],
            ].filter(Boolean)
          )
        ),
        row.record.type === "lead"
          ? el(
              "div",
              { style: { marginTop: "var(--space-5)" } },
              button({
                label: "Open the full lead",
                variant: "primary",
                trailingIcon: "arrowRight",
                onClick: () => navigate(`/leads/${row.record.id}`),
              })
            )
          : null
      ),
      el(
        "section.card",
        null,
        sectionHeader({ ruled: true, title: "Message history" }),
        row.type === "call"
          ? note(
              row.transcript_available
                ? "This call has a transcript. It is encrypted at rest and contains clinical detail, so it is not shown in the console — retrieve it through your compliance process."
                : "No transcript was captured for this call.",
              "neutral"
            )
          : note(
              "Message text is not retained. The engine keeps the qualification answers and discards the wording, so there is no thread to display.",
              "neutral"
            )
      ),
      row.handling === "needs_human"
        ? el(
            "section.card",
            null,
            sectionHeader({ ruled: true, title: "Why this needs you" }),
            el("p.small.secondary", {
              text:
                row.type === "call"
                  ? "The phone agent hit a clinical question and promised a provider callback within two hours."
                  : "This enquiry raised something the AI is not allowed to answer — a clinical question or a medication flag.",
            })
          )
        : null
    )
  );
}
