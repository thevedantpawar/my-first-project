/**
 * The guided sales walkthrough.
 *
 * Ten steps that carry a prospect through the whole revenue loop — enquiry,
 * qualification, booking, no-show, recovery, revenue — in about ten minutes.
 *
 * Two design decisions worth defending:
 *
 * **It navigates the real console.** Every step moves to a real route showing
 * real records from the seeded clinic. There is no separate slideshow and no
 * screenshot: what the prospect is shown is the product they would buy, and
 * anything they click during the demo works, because it is the product.
 *
 * **It only runs on demo data.** The tour is unavailable unless demo mode is
 * active and the Glow Aesthetics records are present. Narrating a real
 * clinic's live figures as a sales script is a category error, and the
 * narration below — "here is a patient who missed her appointment" — would be
 * pointing at a real person.
 *
 * Progress lives in sessionStorage because each step is a route change and a
 * route change re-renders the page.
 */

import { el, mount, clear } from "../dom.js";
import { icon } from "../icons.js";
import { navigate } from "../router.js";
import { state } from "../store.js";
import { button, iconButton } from "./components.js";

const STEP_KEY = "microns.console.tourStep";

/**
 * Each step names the screen and says what the prospect is looking at.
 *
 * The narration deliberately talks about the clinic's business rather than
 * the software's features: "she missed a $240 appointment" lands, "the
 * retention service emits a REACTIVATION_SENT event" does not.
 */
export const STEPS = [
  {
    route: "/team",
    title: "Meet your AI revenue team",
    body: "Five agents, each with one job. They answer the phone, qualify enquiries, chase no-shows, win back clients who drifted away, and ask for reviews. Every status here is live — nothing is switched on that isn't actually connected.",
  },
  {
    route: "/leads",
    title: "An enquiry comes in at 9pm",
    body: "Every person who has contacted the clinic, scored out of a hundred. Nobody typed these scores in — each one is the engine's own reading of what the person told it.",
  },
  {
    route: "/conversations",
    title: "It answers in seconds",
    body: "Six questions: what treatment, have you had it before, are you pregnant, any blood thinners, what budget, how soon. The same six a good coordinator asks. It just never goes home.",
  },
  {
    route: "/test-center",
    title: "Try it yourself",
    body: "Run a live enquiry through the engine right now. Answer as a patient would and watch the score move. This is the same code path a real enquiry takes.",
  },
  {
    route: "/appointments",
    title: "The strong ones get booked",
    body: "High-intent enquiries are offered a consultation immediately. Every appointment shows whether the AI booked it or your front desk did, so the contribution is never in dispute.",
  },
  {
    route: "/opportunities",
    title: "Anything clinical stops",
    body: "Pregnancy and blood thinners do not get an answer from software. They get flagged for a provider and they sit at the top of this queue until a human deals with them.",
  },
  {
    route: "/recovery",
    title: "Somebody misses their appointment",
    body: "It happens to every clinic. What matters is the next two hours: the engine sends the recovery message the same day, then a rebooking credit if that goes unanswered.",
  },
  {
    route: "/recovery",
    title: "And most of them come back",
    body: "Scroll to the individual attempts. Each row is one missed appointment, the follow-up that went out, and what happened next. Note the ones that never responded — this is a real rate, not a brochure number.",
  },
  {
    route: "/revenue",
    title: "What that is worth",
    body: "Appointments the AI booked, no-shows it recovered, dormant clients it brought back — each with the count behind it. The console reports how many appointments carry a price, so you always know how complete the figure is.",
  },
  {
    route: "/overview",
    title: "And this is the morning view",
    body: "The whole picture in one screen: what came in, what needs a person, and what the team did overnight. This is the page an owner actually opens.",
  },
];

let panel = null;
let root = null;

export function tourAvailable() {
  const demo = state.system?.demo;
  return Boolean(demo?.active && demo?.seeded);
}

export function isTourRunning() {
  return currentStep() !== null;
}

function currentStep() {
  try {
    const raw = sessionStorage.getItem(STEP_KEY);
    if (raw === null) return null;
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 && index < STEPS.length ? index : null;
  } catch {
    return null;
  }
}

function setStep(index) {
  try {
    if (index === null) sessionStorage.removeItem(STEP_KEY);
    else sessionStorage.setItem(STEP_KEY, String(index));
  } catch {
    /* A private window without storage still gets a working console. */
  }
}

export function initTour(container) {
  root = container;
  render();
}

export function startTour() {
  if (!tourAvailable()) return;
  goTo(0);
}

export function endTour() {
  setStep(null);
  render();
}

function goTo(index) {
  if (index < 0 || index >= STEPS.length) return endTour();
  setStep(index);
  navigate(STEPS[index].route);
  render();
}

function render() {
  if (!root) return;
  const index = currentStep();

  if (index === null || !tourAvailable()) {
    clear(root);
    panel = null;
    return;
  }

  const step = STEPS[index];
  const first = index === 0;
  const last = index === STEPS.length - 1;

  panel = el(
    "aside.tour",
    { role: "dialog", "aria-label": "Guided walkthrough", "aria-live": "polite" },
    el(
      "div.tour__head",
      null,
      el("span.tour__count", { text: `${index + 1} / ${STEPS.length}` }),
      el("h2.tour__title", { text: step.title }),
      iconButton({ name: "close", label: "End walkthrough", onClick: endTour })
    ),
    el("p.tour__body", { text: step.body }),
    el(
      "div.tour__foot",
      null,
      el(
        "div.tour__dots",
        { "aria-hidden": "true" },
        STEPS.map((_, position) =>
          el("span", {
            class: `tour__dot${position === index ? " tour__dot--on" : ""}${position < index ? " tour__dot--done" : ""}`,
          })
        )
      ),
      el(
        "div.row",
        { style: { gap: "var(--space-2)" } },
        first
          ? null
          : button({ label: "Back", variant: "ghost", onClick: () => goTo(index - 1) }),
        last
          ? button({ label: "Finish", variant: "primary", onClick: endTour })
          : button({
              label: "Next",
              variant: "primary",
              trailingIcon: "arrowRight",
              onClick: () => goTo(index + 1),
            })
      )
    )
  );

  mount(root, panel);
}

/** Re-paint after a route change so the panel survives navigation. */
export function refreshTour() {
  render();
}

/** The button offered in the demonstration banner. */
export function tourLaunchButton() {
  return button({
    label: isTourRunning() ? "Resume walkthrough" : "Start guided walkthrough",
    variant: "secondary",
    iconName: "play",
    onClick: () => (isTourRunning() ? refreshTour() : startTour()),
  });
}
