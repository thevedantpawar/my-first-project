/**
 * Settings — clinic profile, what is connected, and the advanced view.
 *
 * Read-only. This engine takes its configuration from the deployment's
 * environment, and a console that pretended to edit encryption keys or safety
 * thresholds from a web form would be lying about where the truth lives. What
 * the page does do is say precisely what each setting is and where to change
 * it.
 */

import { el } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { load } from "../store.js";
import { api } from "../api.js";
import {
  badge,
  button,
  keyValues,
  modeBadge,
  note,
  pageHeader,
  sectionHeader,
  skeletonCards,
  tabs,
} from "../ui/components.js";
import { renderAsync } from "./common.js";

const TABS = [
  { value: "connections", label: "Connections" },
  { value: "clinic", label: "Clinic" },
  { value: "behaviour", label: "AI behaviour" },
  { value: "advanced", label: "Advanced" },
];

let activeTab = "connections";

export async function renderSettings(container, ctx = {}) {
  if (ctx.params?.tab && TABS.some((tab) => tab.value === ctx.params.tab)) {
    activeTab = ctx.params.tab;
  }

  const body = el("div");
  const tabSlot = el("div", { style: { marginBottom: "var(--space-6)" } });

  container.replaceChildren(
    pageHeader({
      eyebrow: "Settings",
      title: "Your setup",
      subtitle: "What your engine is connected to and how it is configured.",
    }),
    tabSlot,
    body
  );

  tabSlot.replaceChildren(
    tabs({
      items: TABS,
      active: activeTab,
      label: "Settings sections",
      onChange: (value) => {
        activeTab = value;
        renderSettings(container);
      },
    })
  );

  return renderAsync(
    body,
    () => Promise.all([load.system(), api.health()]),
    ([system, health]) => {
      if (activeTab === "connections") return connectionsTab(system);
      if (activeTab === "clinic") return clinicTab(system);
      if (activeTab === "behaviour") return behaviourTab(system);
      return advancedTab(system, health);
    },
    { skeleton: () => skeletonCards(3, { tall: true }), context: "Couldn't load your settings" }
  );
}

/* -------------------------------------------------------------------------
   Connections
   ------------------------------------------------------------------------- */
const CONNECTION_ICONS = {
  phone: "phone",
  sms: "message",
  ai: "sparkle",
  calendar: "calendar",
  booking: "building",
};

function connectionsTab(system) {
  const connected = system.integrations.filter((item) => item.connected).length;

  return el(
    "div.stack.stack--loose",
    null,
    el(
      "div.card",
      null,
      el(
        "div.row.row--between.row--wrap",
        { style: { gap: "var(--space-4)" } },
        el(
          "div.stack",
          { style: { gap: "2px" } },
          el("h2.card-title", { text: `${connected} of ${system.integrations.length} services connected` }),
          el("p.small.secondary", {
            text: "A service that is not connected is not a failure — the engine keeps working and records what it would have done.",
          })
        ),
        badge(system.is_production ? "Production" : `${fmt.titleCase(system.environment)} environment`,
          system.is_production ? "positive" : "attention")
      )
    ),

    el("div.grid.grid--2", null, system.integrations.map(integrationCard)),

    system.warnings?.length
      ? el(
          "section.card",
          null,
          sectionHeader({ title: "Setup warnings", subtitle: "Reported by the engine at startup." }),
          el(
            "ul.stack.stack--tight",
            null,
            system.warnings.map((warning) => el("li", null, note(warning, "warn")))
          )
        )
      : null
  );
}

function integrationCard(integration) {
  return el(
    "article.card",
    { style: { display: "flex", flexDirection: "column", gap: "var(--space-4)" } },
    el(
      "div.row.row--between",
      { style: { alignItems: "flex-start", gap: "var(--space-3)" } },
      el(
        "div.row",
        { style: { gap: "var(--space-3)", minWidth: 0 } },
        el(
          "span",
          {
            style: {
              width: "36px",
              height: "36px",
              borderRadius: "var(--radius-md)",
              background: integration.connected ? "var(--positive-bg)" : "var(--neutral-bg)",
              color: integration.connected ? "var(--positive)" : "var(--ink-muted)",
              display: "grid",
              placeItems: "center",
              flex: "none",
            },
          },
          icon(CONNECTION_ICONS[integration.id] || "plug", 18)
        ),
        el(
          "div.stack",
          { style: { gap: "2px", minWidth: 0 } },
          el("h3.card-title", { text: integration.name }),
          el("p.xsmall.muted", { text: integration.purpose })
        )
      ),
      modeBadge(integration.connected ? "live" : "not_connected")
    ),
    el("p.small.secondary", { text: integration.detail }),
    el(
      "p.xsmall.muted",
      { style: { borderTop: "1px solid var(--line-faint)", paddingTop: "var(--space-3)" } },
      `Provider: ${fmt.titleCase(integration.provider)}`
    )
  );
}

/* -------------------------------------------------------------------------
   Clinic
   ------------------------------------------------------------------------- */
function clinicTab(system) {
  return el(
    "div.stack.stack--loose",
    null,
    el(
      "section.card",
      null,
      sectionHeader({ title: "Business details" }),
      keyValues([
        ["Clinic name", system.clinic.name],
        ["Time zone", system.clinic.timezone],
        ["Opening hours", system.clinic.hours],
        ["Booking page", el("a", { href: system.clinic.booking_url, target: "_blank", rel: "noopener", text: system.clinic.booking_url })],
        ["Review link", el("a", { href: system.clinic.review_url, target: "_blank", rel: "noopener", text: system.clinic.review_url })],
      ])
    ),
    note(
      "These come from your deployment's configuration. Ask whoever set up your Microns installation to change them — they are not editable from the browser by design.",
      "neutral"
    )
  );
}

/* -------------------------------------------------------------------------
   AI behaviour
   ------------------------------------------------------------------------- */
function behaviourTab(system) {
  const retention = system.retention;

  return el(
    "div.stack.stack--loose",
    null,
    el(
      "section.card",
      null,
      sectionHeader({ title: "When your team reaches out", subtitle: "The timings the automations follow." }),
      keyValues([
        [
          "Dormant after",
          `${retention.reactivation_days} days without a visit`,
        ],
        ["Review requested", `${retention.review_request_delay_days} days after a treatment`],
        ["Rebooking credit", fmt.money(retention.no_show_credit_amount * 100)],
        [
          "Treatment names in texts",
          retention.sms_include_treatment_details
            ? badge("Included", "attention")
            : badge("Kept out of messages", "positive"),
        ],
      ]),
      retention.sms_include_treatment_details
        ? note(
            "Treatment names appear in text messages. Texts show on lock screens — consider turning this off.",
            "warn"
          )
        : note(
            "Messages say 'your appointment' rather than naming the treatment, because texts land on lock screens.",
            "neutral"
          )
    ),
    el(
      "section.card",
      null,
      sectionHeader({ title: "Safety rules that cannot be turned off" }),
      el(
        "ul.stack.stack--tight",
        null,
        [
          "The phone agent never answers a clinical question — it books a provider callback within 2 hours.",
          "Pregnancy or breastfeeding disqualifies a lead outright, whatever else they answered.",
          "Blood thinners flag a lead for provider approval without changing their score.",
          "Bookings taken by phone are held as pending until your front desk confirms them.",
          "Reminders are transactional; recovery and review messages require marketing consent, and STOP is honoured automatically.",
        ].map((rule) =>
          el(
            "li.row",
            { style: { gap: "var(--space-3)", alignItems: "flex-start" } },
            el("span", { style: { color: "var(--positive)", marginTop: "2px" } }, icon("shield", 15)),
            el("span.small", { text: rule })
          )
        )
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Advanced
   ------------------------------------------------------------------------- */
function advancedTab(system, health) {
  const advanced = system.advanced;

  return el(
    "div.stack.stack--loose",
    null,
    el(
      "section.card",
      null,
      sectionHeader({ title: "System", subtitle: "For whoever runs this deployment." }),
      keyValues([
        ["Version", el("span.code", { text: health.version })],
        ["Environment", el("span.code", { text: system.environment })],
        ["Database", el("span.code", { text: advanced.database })],
        ["Database status", health.database === "ok" ? badge("Healthy", "positive", { dot: true }) : badge(health.database, "critical")],
        ["Booking system", el("span.code", { text: advanced.booking_system_type })],
        ["Appointment slot", `${advanced.slot_minutes} minutes`],
      ])
    ),
    el(
      "section.card",
      null,
      sectionHeader({ title: "Data protection" }),
      keyValues([
        [
          "Encryption key",
          advanced.encryption_configured
            ? badge("Configured", "positive", { dot: true })
            : badge("Not configured", "critical", { dot: true }),
        ],
        ["AI provider", el("span.code", { text: advanced.llm_provider })],
        [
          "AI zero data retention",
          advanced.zero_data_retention
            ? badge("Requested on every call", "positive")
            : badge("Not available", "attention"),
        ],
      ]),
      advanced.llm_provider === "gemini" && !advanced.zero_data_retention
        ? note(
            "Prompts are de-identified before they leave this system, but the Gemini Developer API has no zero-retention setting and Google's BAA covers Vertex AI rather than this endpoint. Treat this configuration as not BAA-covered.",
            "warn"
          )
        : null,
      note(
        "Client names, phone numbers, call transcripts and notes are encrypted in the database. This console only ever receives masked values, and every read is written to the audit trail.",
        "neutral"
      ),
      !advanced.encryption_configured
        ? note(
            "No encryption key is configured, so an ephemeral one is in use and encrypted data will be unreadable after a restart. This needs fixing before real client data goes in.",
            "warn"
          )
        : null
    ),
    el(
      "section.card",
      null,
      sectionHeader({ title: "Developer interfaces" }),
      el(
        "div.row.row--wrap",
        { style: { gap: "var(--space-2)" } },
        button({ label: "Health endpoint", variant: "secondary", size: "sm", href: "/health", ariaLabel: "Open the health endpoint" }),
        system.is_production
          ? null
          : button({ label: "API documentation", variant: "secondary", size: "sm", href: "/docs" }),
        button({ label: "Chat widget demo", variant: "secondary", size: "sm", href: "/widget/demo.html" })
      ),
      system.is_production
        ? note("Interactive API documentation is disabled in production.", "neutral")
        : null
    )
  );
}
