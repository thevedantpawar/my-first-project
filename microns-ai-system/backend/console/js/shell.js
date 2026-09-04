/**
 * The application shell: sign-in, sidebar, topbar and the page container.
 */

import { el, mount, clear } from "./dom.js";
import { icon } from "./icons.js";
import { api, auth, ApiError } from "./api.js";
import { state, subscribe, setWindow, invalidate } from "./store.js";
import { navigate} from "./router.js";
import { button, iconButton, badge, note } from "./ui/components.js";
import { openPalette, toast } from "./ui/overlays.js";
import { initTour, tourLaunchButton } from "./ui/tour.js";

export const NAV = [
  {
    label: "Operate",
    items: [
      { path: "/overview", label: "Overview", icon: "overview" },
      { path: "/opportunities", label: "Opportunities", icon: "opportunity", badge: "opportunities" },
      { path: "/conversations", label: "Conversations", icon: "inbox" },
      { path: "/leads", label: "Leads", icon: "leads" },
      { path: "/appointments", label: "Appointments", icon: "calendar" },
      { path: "/revenue", label: "Revenue", icon: "revenue" },
      { path: "/recovery", label: "Recovery", icon: "refresh" },
    ],
  },
  {
    label: "Automate",
    items: [
      { path: "/team", label: "AI Team", icon: "agents" },
      { path: "/automations", label: "Automations", icon: "workflow" },
    ],
  },
  {
    label: "Understand",
    items: [{ path: "/insights", label: "Insights", icon: "insights" }],
  },
  {
    label: "Advanced",
    items: [
      { path: "/test-center", label: "AI Test Center", icon: "lab" },
      { path: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

const PAGE_TITLES = Object.fromEntries(
  NAV.flatMap((group) => group.items.map((item) => [item.path, item.label]))
);

/* -------------------------------------------------------------------------
   Sign-in
   ------------------------------------------------------------------------- */
export function renderSignIn(container, { onSuccess, reason }) {
  const input = el("input.input", {
    type: "password",
    id: "staff-token",
    autocomplete: "current-password",
    placeholder: "Paste your staff access token",
    "aria-describedby": "staff-token-hint",
  });
  const errorNode = el("p.error-text", { role: "alert", hidden: true });
  const submit = button({
    label: "Open console",
    variant: "primary",
    block: true,
    type: "submit",
  });

  async function attempt(event) {
    event?.preventDefault();
    errorNode.hidden = true;
    input.setAttribute("aria-invalid", "false");
    const value = input.value.trim();
    if (!value) {
      errorNode.textContent = "Enter the staff access token to continue.";
      errorNode.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Checking…";
    auth.token = value;
    try {
      await api.session();
      onSuccess();
    } catch (error) {
      auth.clear();
      errorNode.textContent =
        error instanceof ApiError && error.isAuth
          ? "That token was not accepted. Check it with whoever set up this clinic."
          : error.message;
      errorNode.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.focus();
    } finally {
      submit.disabled = false;
      mount(submit, el("span", { text: "Open console" }));
    }
  }

  const form = el(
    "form.stack",
    { onSubmit: attempt, novalidate: "" },
    el(
      "div.field",
      null,
      el("label.label", { for: "staff-token", text: "Staff access token" }),
      input,
      el("p.hint", {
        id: "staff-token-hint",
        text: "The token your Microns deployment was configured with. It is kept for this browser tab only.",
      }),
      errorNode
    ),
    submit
  );

  mount(
    container,
    el(
      "div",
      {
        style: {
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "var(--space-6)",
        },
      },
      el(
        "div.stack.stack--loose",
        { style: { width: "min(400px, 100%)" } },
        el(
          "div.stack.stack--tight",
          { style: { textAlign: "center", alignItems: "center" } },
          el("div.brand-mark", { style: { width: "46px", height: "46px", borderRadius: "12px" } }, icon("micronsMark", 22)),
          el("p.eyebrow", { style: { marginTop: "var(--space-3)" }, text: "Microns" }),
          el("h1.page-title", { text: "Revenue Engine" }),
          el("p.page-subtitle", {
            style: { textAlign: "center" },
            text: "Sign in to see what your AI team handled today.",
          })
        ),
        reason ? note(reason, "warn") : null,
        el("div.card", null, form),
        el("p.xsmall.muted", { style: { textAlign: "center" } },
          "Access is audited. Every read of client data is recorded.")
      )
    )
  );

  requestAnimationFrame(() => input.focus());
}

/* -------------------------------------------------------------------------
   Shell
   ------------------------------------------------------------------------- */
let pageContainer;
let navLinks = new Map();
let demoBannerNode;
let tourNode;
let breadcrumbNode;
let sidebarNode;
let scrimNode;
let statusNode;

export function renderShell(container, { onSignOut }) {
  navLinks = new Map();

  const groups = NAV.map((group) =>
    el(
      "div.nav-group",
      null,
      el("p.nav-group__label", { text: group.label }),
      el(
        "ul.stack",
        { style: { gap: "2px" } },
        group.items.map((item) => {
          const count = el("span.nav-item__count", { hidden: true });
          const link = el(
            "a.nav-item",
            { href: `#${item.path}`, onClick: closeSidebarOnMobile },
            el("span.nav-item__icon", null, icon(item.icon, 17)),
            el("span.nav-item__label", { text: item.label }),
            count
          );
          navLinks.set(item.path, { link, count, badge: item.badge });
          return el("li", null, link);
        })
      )
    )
  );

  statusNode = el("button.system-pill", {
    type: "button",
    onClick: () => navigate("/settings?tab=connections"),
  });

  sidebarNode = el(
    "aside.sidebar",
    { dataset: { open: "false" }, "aria-label": "Main" },
    el(
      "div.sidebar__brand",
      null,
      el("span.brand-mark", null, icon("micronsMark", 17)),
      el(
        "span.brand-text",
        null,
        el("span.brand-text__name", { text: "MICRONS" }),
        el("span.brand-text__product", { text: "Revenue Engine" })
      )
    ),
    el(
      "button.tenant",
      {
        type: "button",
        onClick: () => navigate("/settings"),
        "aria-label": "Clinic settings",
      },
      el("span.tenant__avatar", { id: "tenant-initials", text: "··" }),
      el(
        "span.tenant__text",
        null,
        el("span.tenant__name", { id: "tenant-name", text: "Loading…" }),
        el("span.tenant__meta", { id: "tenant-meta", text: "AI Revenue Operations" })
      ),
      icon("arrowDown", 14)
    ),
    el("nav.sidebar__nav", { "aria-label": "Sections" }, groups),
    el(
      "div.sidebar__footer",
      null,
      statusNode,
      el(
        "button.account",
        { type: "button", onClick: onSignOut, "aria-label": "Sign out" },
        el("span.avatar.avatar--sm.avatar--neutral", { "aria-hidden": "true" }, "ST"),
        el(
          "span",
          { style: { flex: 1, minWidth: 0 } },
          el("span.small", { style: { display: "block", fontWeight: "var(--weight-medium)" }, text: "Clinic staff" }),
          el("span.xsmall.muted", { text: "Sign out" })
        ),
        icon("logout", 15)
      )
    )
  );

  breadcrumbNode = el(
    "nav.breadcrumb",
    { "aria-label": "Breadcrumb" },
    el("span", { text: "Glow" }),
    el("span", { "aria-hidden": "true", text: "/" }),
    el("span.breadcrumb__current", { text: "Overview" })
  );

  const windowSelect = el(
    "select.select",
    {
      "aria-label": "Time period",
      style: { height: "36px", padding: "0 var(--space-7) 0 var(--space-3)", width: "auto" },
      onChange: (event) => setWindow(Number(event.target.value)),
    },
    [7, 30, 90].map((days) =>
      el("option", { value: String(days), selected: days === state.windowDays }, `Last ${days} days`)
    )
  );

  const topbar = el(
    "header.topbar",
    null,
    el(
      "button.icon-btn.topbar__menu",
      { type: "button", "aria-label": "Open navigation", onClick: toggleSidebar },
      icon("menu", 20)
    ),
    breadcrumbNode,
    el("div.topbar__spacer"),
    el(
      "button.search-trigger",
      { type: "button", onClick: openPalette, "aria-label": "Search (Command K)" },
      icon("search", 16),
      el("span.search-trigger__label", { style: { flex: 1, textAlign: "left" }, text: "Search" }),
      el("span.kbd", { text: modifierKey() + "K" })
    ),
    windowSelect,
    iconButton({
      name: "refresh",
      label: "Refresh data",
      bordered: true,
      onClick: () => {
        invalidate();
        toast({ title: "Refreshed", variant: "success", timeout: 2000 });
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      },
    })
  );

  // Demonstration data must be impossible to mistake for a clinic's own
  // records, so the notice sits above the content on every single page rather
  // than in a settings screen nobody opens.
  demoBannerNode = el("div", { id: "demo-banner", hidden: true });
  tourNode = el("div", { id: "tour-root" });

  pageContainer = el("main", { id: "main", tabindex: "-1" });
  scrimNode = el("div.scrim", { dataset: { visible: "false" }, onClick: closeSidebar });

  mount(
    container,
    el("a.skip-link", { href: "#main", text: "Skip to content" }),
    el("div.app", null, sidebarNode, el("div.content", null, topbar, demoBannerNode, pageContainer)),
    tourNode,
    scrimNode
  );

  subscribe(refreshChrome);
  refreshChrome();
  initTour(tourNode);
  return pageContainer;
}

/**
 * The demonstration notice.
 *
 * Two states, and the difference matters. Demo mode *configured* with nothing
 * seeded is an empty demo — the console would otherwise look like a clinic
 * having a very quiet month, which is the more damaging misreading of the
 * two. Demo mode with data says whose data it is and that none of it is real.
 */
function renderDemoBanner(demo) {
  if (!demoBannerNode) return;

  if (!demo || !demo.active) {
    demoBannerNode.hidden = true;
    clear(demoBannerNode);
    return;
  }

  demoBannerNode.hidden = false;
  mount(
    demoBannerNode,
    el(
      "div",
      { class: `demo-banner demo-banner--${demo.seeded ? "seeded" : "empty"}`, role: "status" },
      el("span.demo-banner__tag", { text: "Demonstration" }),
      el("span.demo-banner__text", {
        text: demo.seeded
          ? `You are looking at ${demo.clinic}, a fictional clinic. Every patient, appointment and figure here is demonstration data — no real patient information is present.`
          : "Demo mode is on, but no demonstration data has been loaded, so every figure below is genuinely zero. Run `python -m app.cli demo seed` to load the example clinic.",
      }),
      demo.seeded ? el("span.demo-banner__action", null, tourLaunchButton()) : null
    )
  );
}

function modifierKey() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl ";
}

export function getPageContainer() {
  return pageContainer;
}

export function setBreadcrumb(label, parent) {
  if (!breadcrumbNode) return;
  const demo = state.system?.demo;
  const clinic =
    demo?.active && demo?.seeded ? demo.clinic : state.system?.clinic?.name || "Clinic";
  mount(
    breadcrumbNode,
    el("span", { text: clinic }),
    el("span", { "aria-hidden": "true", text: "/" }),
    parent
      ? [
          el("a", { href: `#${parent.path}`, text: parent.label }),
          el("span", { "aria-hidden": "true", text: "/" }),
        ]
      : null,
    el("span.breadcrumb__current", { text: label })
  );
  document.title = `${label} · Microns Revenue Engine`;
}

export function highlightNav(path) {
  navLinks.forEach(({ link }, itemPath) => {
    const active = path === itemPath || path.startsWith(`${itemPath}/`);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const title = PAGE_TITLES[path] || PAGE_TITLES[`/${path.split("/")[1]}`];
  if (title) setBreadcrumb(title);
}

function refreshChrome() {
  const system = state.system;
  renderDemoBanner(system?.demo);
  if (system) {
    // A seeded demo shows the demo clinic's name. Leaving the configured
    // name up while every record belongs to Glow Aesthetics reads as a bug,
    // and the banner immediately above says the clinic is fictional.
    const name =
      system.demo?.active && system.demo?.seeded
        ? system.demo.clinic
        : system.clinic?.name || "Clinic";
    setText("tenant-name", name);
    setText("tenant-initials", name.slice(0, 2).toUpperCase());
    setText(
      "tenant-meta",
      system.is_production ? "AI Revenue Operations" : `${system.environment} environment`
    );
  }

  if (statusNode) {
    const integrations = system?.integrations || [];
    const connected = integrations.filter((item) => item.connected).length;
    const tone = !integrations.length
      ? "off"
      : connected === integrations.length
        ? "live"
        : connected === 0
          ? "critical"
          : "warn";
    mount(
      statusNode,
      el("span", { class: `dot dot--${tone}` }),
      el(
        "span",
        { style: { flex: 1, minWidth: 0 } },
        el("span", {
          style: { display: "block", fontWeight: "var(--weight-medium)" },
          text: integrations.length ? `${connected} of ${integrations.length} connected` : "System status",
        })
      ),
      icon("arrowRight", 13)
    );
  }

  const opportunities = navLinks.get("/opportunities");
  if (opportunities && state.opportunityCount !== null) {
    opportunities.count.hidden = state.opportunityCount === 0;
    opportunities.count.textContent = String(state.opportunityCount);
    opportunities.link.setAttribute(
      "aria-label",
      `Opportunities, ${state.opportunityCount} waiting`
    );
  }
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

/* -------------------------------------------------------------------------
   Mobile navigation
   ------------------------------------------------------------------------- */
function toggleSidebar() {
  const open = sidebarNode.dataset.open === "true";
  sidebarNode.dataset.open = String(!open);
  scrimNode.dataset.visible = String(!open);
}

function closeSidebar() {
  sidebarNode.dataset.open = "false";
  scrimNode.dataset.visible = "false";
}

function closeSidebarOnMobile() {
  if (window.matchMedia("(max-width: 900px)").matches) closeSidebar();
}
