/**
 * Automations — the five orchestration workflows, drawn as the sequence a
 * person would describe rather than as a node graph.
 */

import { el } from "../dom.js";
import { icon } from "../icons.js";
import * as fmt from "../format.js";
import { load } from "../store.js";
import {
  button,
  keyValues,
  modeBadge,
  note,
  pageHeader,
  sectionHeader,
  skeletonCards,
} from "../ui/components.js";
import { openDrawer } from "../ui/overlays.js";
import { renderAsync } from "./common.js";

export async function renderAutomations(container) {
  const body = el("div");

  container.replaceChildren(
    pageHeader({
      eyebrow: "Automations",
      title: "What runs on its own",
      subtitle: "The sequences your engine follows without anyone pressing a button.",
    }),
    body
  );

  return renderAsync(
    body,
    () => load.workflows(),
    (workflows) =>
      el(
        "div.stack.stack--loose",
        null,
        note(
          "These sequences are orchestrated by n8n, which runs alongside this system. The console can see every action they caused here — it cannot see whether a workflow is switched on inside n8n, so it does not claim to.",
          "neutral"
        ),
        el("div.stack", null, workflows.map(workflowCard))
      ),
    { skeleton: () => skeletonCards(2, { tall: true }), context: "Couldn't load your automations" }
  );
}

function workflowCard(workflow) {
  return el(
    "article.card",
    null,
    el(
      "div.row.row--between.row--wrap",
      { style: { alignItems: "flex-start", gap: "var(--space-4)" } },
      el(
        "div.stack",
        { style: { gap: "2px", minWidth: 0 } },
        el("h3.card-title", { text: workflow.title }),
        el("p.small.secondary", { text: workflow.summary })
      ),
      el(
        "div.row",
        { style: { gap: "var(--space-2)" } },
        modeBadge("unknown"),
        button({
          label: "Details",
          variant: "ghost",
          size: "sm",
          trailingIcon: "arrowRight",
          onClick: () => openWorkflow(workflow),
        })
      )
    ),
    el("div", { style: { marginTop: "var(--space-5)" } }, flowDiagram(workflow.steps)),
    el(
      "div.row.row--between.row--wrap",
      {
        style: {
          borderTop: "1px solid var(--line-faint)",
          marginTop: "var(--space-5)",
          paddingTop: "var(--space-4)",
          gap: "var(--space-4)",
        },
      },
      el(
        "span.small",
        null,
        el("span.numeric", { style: { fontWeight: "var(--weight-semibold)" }, text: fmt.number(workflow.actions_30d) }),
        el("span.muted", { text: " actions in the last 30 days" })
      ),
      el("span.xsmall.muted", {
        // The node count is the n8n graph, which is finer-grained than the
        // steps drawn above — saying "steps" here would contradict them.
        text: workflow.definition_available
          ? `${workflow.node_count} nodes in the n8n definition`
          : "Definition not bundled with this deployment",
      })
    )
  );
}

/**
 * The visual flow. Horizontal on a wide screen, vertical on a phone — a
 * six-node graph squeezed into 360px is not a diagram, it is a smear.
 */
function flowDiagram(steps) {
  return el(
    "ol.flow",
    { "aria-label": "Steps in this automation" },
    steps.map((step, index) =>
      el(
        "li.flow__step",
        null,
        el(
          "span.flow__node",
          null,
          el("span.flow__index", { text: String(index + 1) }),
          el("span", { text: step })
        ),
        index < steps.length - 1
          ? el("span.flow__arrow", { "aria-hidden": "true" }, icon("arrowRight", 14))
          : null
      )
    )
  );
}

function openWorkflow(workflow) {
  openDrawer({
    title: workflow.title,
    subtitle: workflow.summary,
    body: el(
      "div.stack.stack--loose",
      null,
      el(
        "section.stack",
        null,
        sectionHeader({ title: "Steps" }),
        el(
          "ol.stack.stack--tight",
          null,
          workflow.steps.map((step, index) =>
            el(
              "li.row",
              { style: { gap: "var(--space-3)", alignItems: "flex-start" } },
              el(
                "span",
                {
                  style: {
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    background: "var(--accent-50)",
                    color: "var(--accent-ink)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "var(--text-2xs)",
                    fontWeight: "var(--weight-semibold)",
                    flex: "none",
                  },
                  text: String(index + 1),
                }
              ),
              el("span.small", { text: step })
            )
          )
        )
      ),
      el(
        "section.stack",
        null,
        sectionHeader({ title: "Activity" }),
        keyValues([
          ["Actions in 30 days", fmt.number(workflow.actions_30d)],
          ["On/off state", el("span", null, modeBadge("unknown"))],
        ]),
        note(workflow.runtime_note, "neutral")
      ),
      el(
        "details.disclosure",
        null,
        el("summary", { text: "Technical detail" }),
        el(
          "div.disclosure__body",
          null,
          keyValues([
            ["Workflow key", el("span.code", { text: workflow.key })],
            ["Definition file", el("span.code", { text: `n8n-workflows/${workflow.key}.json` })],
            ["Nodes", workflow.node_count === null ? "Not readable from this deployment" : String(workflow.node_count)],
          ])
        )
      )
    ),
  });
}
