/** Plans, the current subscription, and cancellation. */

import { api } from "../api.js";
import { el, toast } from "../dom.js";
import * as fmt from "../format.js";
import { appShell, pageHead } from "../shell.js";

export async function billing(user) {
  const content = el("div.page");
  appShell(user, content);
  content.append(
    pageHead("Billing", "One subscription covers every clinic on this account."),
  );

  const body = el("div");
  content.append(body);

  let plans;
  let subscription;
  try {
    [plans, subscription] = await Promise.all([api.plans(), api.subscription()]);
  } catch (error) {
    body.append(el("div.note.note--error", { text: error.message }));
    return;
  }

  // --- Current state ---
  const tone = subscription.is_entitled ? "ok" : "warn";
  body.append(
    el("section.section", {}, [
      el("div.section__head", {}, [
        el("h2", { text: "Current plan" }),
        el(`span.badge.badge--${tone}`, { text: fmt.titleCase(subscription.status) }),
      ]),
      el("div.card", {}, [
        el("div.kv", {}, [
          kv("Plan", fmt.titleCase(subscription.plan)),
          kv("Clinics", `${subscription.clinics_used} of ${subscription.clinic_limit}`),
          subscription.trial_ends_at ? kv("Trial ends", fmt.date(subscription.trial_ends_at)) : null,
          subscription.current_period_end
            ? kv("Renews", fmt.date(subscription.current_period_end))
            : null,
        ]),
        subscription.status !== "none"
          ? el("div.row", { style: "margin-top: var(--s4)" }, [
              // Razorpay has no billing portal to hand this off to, so
              // cancelling is an action here rather than a link away.
              el("button.btn.btn--secondary", {
                type: "button",
                text: "Cancel subscription",
                onclick: async (event) => {
                  const confirmed = window.confirm(
                    "Cancel at the end of the paid period?\n\n" +
                      "Clinics keep running until then. Nothing is deleted when it " +
                      "ends — their databases and records stay, and they come back " +
                      "if billing resumes.",
                  );
                  if (!confirmed) return;

                  event.target.disabled = true;
                  try {
                    const result = await api.cancelSubscription();
                    toast(
                      result.ends_at
                        ? `Cancelled. Service continues until ${fmt.date(result.ends_at)}.`
                        : "Cancelled at the end of the current period.",
                      "success",
                    );
                    billing(user);
                  } catch (error) {
                    toast(error.message, "error");
                    event.target.disabled = false;
                  }
                },
              }),
            ])
          : null,
      ]),
    ]),
  );

  if (!subscription.is_entitled) {
    body.append(
      el("div.note.note--warn", {
        text:
          "Without an active subscription, clinics on this account are paused. " +
          "Nothing is deleted — their databases and records are untouched, and they " +
          "come back as soon as billing resumes.",
      }),
    );
  }

  // --- Plans ---
  body.append(
    el("section.section", {}, [
      el("div.section__head", {}, [el("h2", { text: "Plans" })]),
      el(
        "div.plans",
        {},
        plans.plans.map((plan) =>
          el("article.card.plan", { dataset: { current: String(plan.id === subscription.plan) } }, [
            el("div.plan__name", { text: plan.name }),
            el("div", {}, [
              el("span.plan__limit", { text: String(plan.clinic_limit) }),
              el("span.plan__unit", {
                text: plan.clinic_limit === 1 ? " clinic" : " clinics",
              }),
            ]),
            el("p.small.muted", { text: plan.description }),
            el("button.btn.btn--primary", {
              type: "button",
              text:
                plan.id === subscription.plan && subscription.is_entitled
                  ? "Current plan"
                  : `Choose ${plan.name}`,
              disabled: plan.id === subscription.plan && subscription.is_entitled,
              onclick: async (event) => {
                event.target.disabled = true;
                try {
                  const { checkout_url } = await api.checkout(plan.id);
                  window.location.href = checkout_url;
                } catch (error) {
                  toast(error.message, "error");
                  event.target.disabled = false;
                }
              },
            }),
          ]),
        ),
      ),
    ]),
  );
}

function kv(key, value) {
  return el("div.kv__row", {}, [
    el("span.kv__key", { text: key }),
    el("span", { text: String(value) }),
  ]);
}
