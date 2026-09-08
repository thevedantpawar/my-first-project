/** The signed-in and signed-out page frames. */

import { el, mount } from "./dom.js";
import { current } from "./router.js";

const NAV = [
  { name: "clinics", label: "Clinics" },
  { name: "billing", label: "Billing" },
  { name: "settings", label: "Settings" },
];

function mark() {
  return el("span.auth-card__mark", { text: "M", "aria-hidden": "true" });
}

/** The signed-out frame: one centred card. */
export function authShell(title, subtitle, body, foot = null) {
  return mount(
    el("main.auth-shell", { id: "main" }, [
      el("div.auth-card", {}, [
        el("div.auth-card__brand", {}, [mark(), "Microns"]),
        el("h1", { text: title }),
        subtitle ? el("p.auth-card__sub", { text: subtitle }) : null,
        el("div", { style: "margin-top: var(--s5)" }, [body]),
        foot ? el("div.auth-card__foot", {}, [foot]) : null,
      ]),
    ]),
  );
}

/** The signed-in frame: navigation rail plus working area. */
export function appShell(user, content) {
  // "clinic" (one clinic) and "new-clinic" both live under the Clinics
  // section, so the rail highlights it rather than nothing.
  const route = current().name || "clinics";
  const active = route === "clinic" || route === "new-clinic" ? "clinics" : route;

  return mount(
    el("div.shell", {}, [
      el("nav.rail", { "aria-label": "Sections" }, [
        el("div.rail__brand", {}, [mark(), "Microns"]),
        el(
          "div.rail__nav",
          {},
          NAV.map((item) =>
            el("a.rail__link", {
              href: `#/${item.name}`,
              text: item.label,
              "aria-current": active === item.name ? "page" : null,
            }),
          ),
        ),
        el("div.rail__foot", {}, [
          el("div", { text: user.account_name }),
          el("div.muted", { text: user.email }),
        ]),
      ]),
      el("main.work", { id: "main" }, [content]),
    ]),
  );
}

export function pageHead(title, description, actions = null) {
  return el("header.page__head", {}, [
    el("div.row.row--between", {}, [
      el("div", {}, [
        el("h1", { text: title }),
        description ? el("p", { text: description }) : null,
      ]),
      actions,
    ]),
  ]);
}
