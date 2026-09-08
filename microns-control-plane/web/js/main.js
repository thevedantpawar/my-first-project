/**
 * Entry point: resolve the session once, then route.
 *
 * Every route is declared as needing a session or not. The check is here rather
 * than inside each page so a new page cannot be added without one — the server
 * enforces access regardless, but a page that renders its shell and then 401s
 * on every request is a bad way to find that out.
 */

import { api } from "./api.js";
import { el, mount } from "./dom.js";
import { go, render, route, setNotFound, start } from "./router.js";
import { billing } from "./pages/billing.js";
import { clinicDetail, clinicList, newClinic } from "./pages/clinics.js";
import { forgotPassword, resetPassword, signIn, signUp } from "./pages/auth.js";
import { settings } from "./pages/settings.js";

let user = null;

/** Routes reachable without a session. Everything else redirects to sign-in. */
const PUBLIC = new Set(["signin", "signup", "forgot", "reset"]);

function requireSession(handler) {
  return async (context) => {
    if (!user) {
      go("signin", { replace: true });
      return;
    }
    await handler(user, ...(context.params || []));
  };
}

function publicOnly(handler) {
  return async (context) => {
    if (user) {
      go("clinics", { replace: true });
      return;
    }
    await handler(context);
  };
}

route("signin", publicOnly(signIn));
route("signup", publicOnly(signUp));
route("forgot", publicOnly(forgotPassword));
route("reset", publicOnly(resetPassword));

route("clinics", requireSession(clinicList));
route("new-clinic", requireSession(newClinic));
route("clinic", requireSession(clinicDetail));
route("billing", requireSession(billing));
route("settings", requireSession(settings));

route("", async () => {
  go(user ? "clinics" : "signin", { replace: true });
});

setNotFound(async () => {
  mount(
    el("main.auth-shell", { id: "main" }, [
      el("div.auth-card", {}, [
        el("h1", { text: "Not found" }),
        el("p.auth-card__sub", { text: "That page does not exist." }),
        el("div", { style: "margin-top: var(--s5)" }, [
          el("a.btn.btn--primary", { href: user ? "#/clinics" : "#/signin", text: "Go back" }),
        ]),
      ]),
    ]),
  );
});

async function boot() {
  try {
    const session = await api.session();
    user = session.authenticated ? session.user : null;
  } catch {
    // A failed session lookup means signed out; the sign-in page can say so
    // better than a crash can.
    user = null;
  }

  const name = window.location.hash.replace(/^#\/?/, "").split("/")[0].split("?")[0];
  if (!window.location.hash || (!user && !PUBLIC.has(name))) {
    go(user ? "clinics" : "signin", { replace: true });
  }

  await start();
}

boot().catch((error) => {
  console.error(error);
  mount(
    el("main.auth-shell", { id: "main" }, [
      el("div.auth-card", {}, [
        el("h1", { text: "Something went wrong" }),
        el("p.auth-card__sub", { text: "Reload the page to try again." }),
      ]),
    ]),
  );
});

// Re-render on hash change is wired by start(); this keeps the session fresh
// after a sign-in or sign-out that reloads.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});

export { render };
