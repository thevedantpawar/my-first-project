/**
 * AI Test Center.
 *
 * This talks to the real qualification endpoint — the same one the website
 * widget uses. That has a consequence the page states in plain sight: a test
 * run creates a real lead record, and if the answers score hot, the engine
 * will do what it does with a hot lead. This is a live rehearsal, not a
 * sandbox, and pretending otherwise would be the exact kind of lie this
 * console exists to avoid.
 */

import { el, mount } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { api } from "../api.js";
import { state, invalidate } from "../store.js";
import {
  badge,
  button,
  keyValues,
  modeBadge,
  note,
  pageHeader,
  sectionHeader,
} from "../ui/components.js";
import { toast } from "../ui/overlays.js";
import { navigate } from "../router.js";

/**
 * Scenarios are scripted answers, not scripted responses. Each entry is what
 * a person would type; every reply on screen comes back from the engine.
 *
 * The engine asks seven things in a fixed order — treatment, prior
 * experience, pregnancy, blood thinners, budget, timing, and finally a phone
 * number so it can confirm a booking. A script has to answer all seven or the
 * run stops mid-qualification with no outcome, so each one does. The phone
 * number is deliberately a reserved 555 test number.
 */
const TEST_PHONE = "+15555550100";

const SCENARIOS = [
  {
    id: "hot_lead",
    title: "High-intent new lead",
    summary: "Wants Botox, has budget, wants it soon. Should score hot and be offered a consultation.",
    script: ["Botox", "No", "No", "No", "$2000+", "asap", TEST_PHONE],
  },
  {
    id: "browsing",
    title: "Just browsing",
    summary: "Curious about facials, no budget, no timeline. Should score cold and go to nurture.",
    script: ["Facial", "No", "No", "No", "$0-500", "browsing", TEST_PHONE],
  },
  {
    id: "pregnancy",
    title: "Safety gate — pregnancy",
    summary: "Answers yes to the pregnancy question. Must be disqualified regardless of every other answer.",
    script: ["Fillers", "Yes", "Yes", "No", "$2000+", "asap", TEST_PHONE],
  },
  {
    id: "blood_thinner",
    title: "Safety flag — blood thinners",
    summary: "On blood thinners. Should flag for provider approval without losing score.",
    script: ["Botox", "Yes", "No", "Yes", "$1000-2000", "1-2 weeks", TEST_PHONE],
  },
  {
    id: "clinical",
    title: "Clinical question",
    summary: "Asks something medical. The AI must refuse to answer and route to a provider callback.",
    script: [
      "Can I get Botox while taking amoxicillin?",
      "Botox",
      "No",
      "No",
      "No",
      "$1000-2000",
      "asap",
      TEST_PHONE,
    ],
  },
];

let running = false;

export async function renderTestCenter(container) {
  const output = el("div");
  const scenarioSlot = el("div.grid.grid--2");

  container.replaceChildren(
    pageHeader({
      eyebrow: "AI Test Center",
      title: "See how your AI responds",
      subtitle: "Run a scenario through the live qualification engine and watch every step it takes.",
      actions: [modeBadge("live")],
    }),
    note(
      "These runs use your live engine. Each one creates a real lead record you will see on the Leads page, and a hot result triggers the same follow-up a real enquiry would. Nothing is faked, so nothing is free of consequence — use test names and test numbers.",
      "warn"
    ),
    el("div.section", null, sectionHeader({ title: "Scenarios" }), scenarioSlot),
    el("div.section", null, output)
  );

  mount(
    scenarioSlot,
    ...SCENARIOS.map((scenario) =>
      el(
        "article.card",
        { style: { display: "flex", flexDirection: "column", gap: "var(--space-4)" } },
        el(
          "div.stack.stack--tight",
          null,
          el("h3.card-title", { text: scenario.title }),
          el("p.small.secondary", { text: scenario.summary })
        ),
        el(
          "div",
          { style: { marginTop: "auto" } },
          button({
            label: "Run scenario",
            variant: "secondary",
            iconName: "play",
            onClick: () => runScenario(scenario, output),
          })
        )
      )
    )
  );

  mount(
    output,
    el(
      "div.card",
      null,
      el(
        "div.state",
        null,
        el("div.state__icon", null, icon("lab", 22)),
        el("p.state__title", { text: "No run yet" }),
        el("p.state__body", {
          text: "Pick a scenario above. You'll see each message, what the engine understood, and the decision it made.",
        })
      )
    )
  );
}

async function runScenario(scenario, output) {
  if (running) return;
  running = true;

  const steps = el("div.stack");
  const header = el(
    "div.row.row--between.row--wrap",
    { style: { gap: "var(--space-3)" } },
    el(
      "div.stack",
      { style: { gap: "2px" } },
      el("h2.section-title", { text: scenario.title }),
      el("p.small.muted", { text: "Running against the live qualification engine" })
    ),
    badge("Running", "info", { dot: true })
  );

  mount(output, el("section.card", null, header, el("div", { style: { marginTop: "var(--space-5)" } }, steps)));

  let sessionId = null;
  let lastResult = null;

  try {
    // The widget opens with an empty turn to get the greeting and the first
    // question. Skipping it would leave the engine with nothing to attach the
    // first answer to, and the run would end unqualified.
    const greeting = await api.chat("__init__", null);
    sessionId = greeting.session_id;
    lastResult = greeting;
    steps.appendChild(
      turnNode({
        role: "ai",
        text: greeting.reply,
        meta: greeting.asking ? `Now asking about: ${fmt.titleCase(greeting.asking)}` : null,
      })
    );

    for (const message of scenario.script) {
      steps.appendChild(turnNode({ role: "customer", text: message }));
      const reply = await api.chat(message, sessionId);
      sessionId = reply.session_id;
      lastResult = reply;
      steps.appendChild(
        turnNode({
          role: "ai",
          text: reply.reply,
          meta: reply.asking ? `Now asking about: ${fmt.titleCase(reply.asking)}` : null,
        })
      );
      if (reply.complete) break;
    }

    mount(
      header,
      el(
        "div.stack",
        { style: { gap: "2px" } },
        el("h2.section-title", { text: scenario.title }),
        el("p.small.muted", { text: "Completed" })
      ),
      badge("Complete", "positive", { dot: true })
    );

    steps.appendChild(outcomeNode(lastResult, sessionId));
    invalidate();
    toast({
      title: "Scenario complete",
      body: "A lead record was created — you can open it from the Leads page.",
      variant: "success",
    });
  } catch (error) {
    mount(
      header,
      el("h2.section-title", { text: scenario.title }),
      badge("Failed", "critical", { dot: true })
    );
    steps.appendChild(
      note(`The run stopped: ${error.message}. Nothing further was sent.`, "warn")
    );
  } finally {
    running = false;
  }
}

function turnNode({ role, text, meta }) {
  const customer = role === "customer";
  return el(
    "div.row",
    {
      style: {
        gap: "var(--space-3)",
        alignItems: "flex-start",
        justifyContent: customer ? "flex-end" : "flex-start",
      },
    },
    customer
      ? null
      : el(
          "span",
          {
            style: {
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "var(--accent-50)",
              color: "var(--accent)",
              display: "grid",
              placeItems: "center",
              flex: "none",
            },
          },
          icon("sparkle", 14)
        ),
    el(
      "div",
      {
        style: {
          maxWidth: "min(62ch, 78%)",
          padding: "var(--space-3) var(--space-4)",
          borderRadius: "var(--radius-lg)",
          background: customer ? "var(--accent)" : "var(--surface-muted)",
          color: customer ? "var(--ink-inverse)" : "var(--ink)",
          border: customer ? "none" : "1px solid var(--line)",
          fontSize: "var(--text-sm)",
        },
      },
      el("span", { text }),
      meta ? el("div.xsmall", { style: { opacity: 0.7, marginTop: "var(--space-2)" }, text: meta }) : null
    )
  );
}

/** Names the vendor actually in use, rather than assuming one. */
function languageModelLabel() {
  const ai = state.system?.integrations?.find((integration) => integration.id === "ai");
  if (!ai || !ai.connected) return "built-in rule engine";
  return `${ai.provider} · ${state.system?.advanced?.llm_provider ?? ""}`.trim();
}

function outcomeNode(result, sessionId) {
  if (!result) return el("div");

  const disqualified = result.status === "disqualified";
  const unfinished = !result.complete && result.status === "qualifying";
  const tone = disqualified ? "attention" : result.score >= 80 ? "positive" : "info";

  return el(
    "div",
    { style: { marginTop: "var(--space-5)" } },
    el(
      "div.card.card--quiet",
      null,
      sectionHeader({ title: "What the engine decided" }),
      keyValues([
        ["Outcome", badge(fmt.statusLabel(result.status), tone, { dot: true })],
        ["Score", result.score === null || result.score === undefined ? fmt.EMPTY : `${result.score}/100`],
        ["Next action", result.next_action ? fmt.titleCase(result.next_action) : fmt.EMPTY],
        ["Booking link", result.booking_url ? "Issued" : "Not issued"],
      ]),
      disqualified
        ? note(
            "The safety gate fired. No combination of the other answers can override a pregnancy or breastfeeding response — the lead is disqualified and a medical callback is booked.",
            "warn"
          )
        : null,
      unfinished
        ? note(
            "The run ended before qualification finished, so there is no score yet. The engine asked something this scenario has no answer for.",
            "warn"
          )
        : null,
      el(
        "div.row",
        { style: { marginTop: "var(--space-4)", gap: "var(--space-2)", flexWrap: "wrap" } },
        button({
          label: "Open the leads list",
          variant: "secondary",
          size: "sm",
          onClick: () => navigate("/leads"),
        })
      ),
      el(
        "details.disclosure",
        { style: { marginTop: "var(--space-4)" } },
        el("summary", { text: "Technical detail" }),
        el(
          "div.disclosure__body",
          null,
          keyValues([
            ["Session id", el("span.code", { text: sessionId || "—" })],
            ["Endpoint", el("span.code", { text: "POST /leads/chat" })],
            [
              "Language model",
              el("span.code", { text: languageModelLabel() }),
            ],
          ])
        )
      )
    )
  );
}
