/**
 * Entry point: authentication gate, routes, command menu.
 */

import { el, mount } from "./dom.js";
import { api, auth, ApiError } from "./api.js";
import { load, invalidate } from "./store.js";
import { defineRoute, setNotFound, onRouteChange, startRouter, navigate } from "./router.js";
import { renderShell, renderSignIn, highlightNav, setBreadcrumb, NAV } from "./shell.js";
import {
  initOverlays,
  openPalette,
  isPaletteOpen,
  registerPaletteSource,
  closeDrawer,
} from "./ui/overlays.js";
import { button, emptyState, pageHeader } from "./ui/components.js";
import * as fmt from "./format.js";

import { renderOverview } from "./pages/overview.js";
import { renderOpportunities } from "./pages/opportunities.js";
import { renderConversations } from "./pages/conversations.js";
import { renderLeads, renderLeadDetail } from "./pages/leads.js";
import { renderAppointments } from "./pages/appointments.js";
import { renderRevenue } from "./pages/revenue.js";
import { renderRecovery } from "./pages/recovery.js";
import { renderTeam } from "./pages/team.js";
import { renderAutomations } from "./pages/automations.js";
import { renderInsights } from "./pages/insights.js";
import { renderTestCenter } from "./pages/testcenter.js";
import { renderSettings } from "./pages/settings.js";

const root = document.getElementById("root");
const overlayRoot = document.getElementById("overlays");

let page = null;

initOverlays(overlayRoot);

/* -------------------------------------------------------------------------
   Authentication gate
   ------------------------------------------------------------------------- */
async function boot({ reason } = {}) {
  try {
    await api.session();
    await startConsole();
  } catch (error) {
    if (error instanceof ApiError && error.isAuth) {
      renderSignIn(root, { onSuccess: () => boot(), reason });
      return;
    }
    // The engine is unreachable or broken. Say so rather than showing an
    // empty console that looks like a clinic with no clients.
    mount(
      root,
      el(
        "div",
        { style: { minHeight: "100vh", display: "grid", placeItems: "center", padding: "var(--space-6)" } },
        el(
          "div.card",
          { style: { maxWidth: "460px" } },
          emptyState({
            iconName: "alert",
            tone: "error",
            title: "The Revenue Engine isn't responding",
            body: `${error.message} Your data is not affected — the console simply cannot reach the server.`,
            actions: [button({ label: "Try again", variant: "primary", iconName: "refresh", onClick: () => boot() })],
          })
        )
      )
    );
  }
}

async function startConsole() {
  page = renderShell(root, { onSignOut: signOut });
  registerRoutes();
  registerPaletteSource(searchSources);
  // The clinic name and connection status shape the whole shell, so this is
  // the one request the console waits on before painting a page.
  await load.system().catch(() => null);
  await startRouter();
}

function signOut() {
  auth.clear();
  invalidate();
  renderSignIn(root, { onSuccess: () => boot(), reason: "You have been signed out." });
}

window.addEventListener("microns:unauthorised", () => {
  auth.clear();
  invalidate();
  renderSignIn(root, {
    onSuccess: () => boot(),
    reason: "Your session was not accepted. Sign in again to continue.",
  });
});

/* -------------------------------------------------------------------------
   Routes
   ------------------------------------------------------------------------- */
function registerRoutes() {
  const routes = [
    ["/overview", renderOverview],
    ["/opportunities", renderOpportunities],
    ["/conversations", renderConversations],
    ["/leads", renderLeads],
    ["/leads/:id", renderLeadDetail],
    ["/appointments", renderAppointments],
    ["/revenue", renderRevenue],
    ["/recovery", renderRecovery],
    ["/team", renderTeam],
    ["/automations", renderAutomations],
    ["/insights", renderInsights],
    ["/test-center", renderTestCenter],
    ["/settings", renderSettings],
  ];

  routes.forEach(([pattern, handler]) => {
    defineRoute(pattern, (context) => handler(page, context));
  });

  setNotFound(() => {
    setBreadcrumb("Not found");
    mount(
      page,
      pageHeader({ title: "Page not found" }),
      el(
        "div.card",
        null,
        emptyState({
          iconName: "search",
          title: "That page doesn't exist",
          body: "The link may be from an older version of the console.",
          actions: [button({ label: "Go to overview", variant: "primary", href: "#/overview" })],
        })
      )
    );
  });

  onRouteChange(({ path }) => {
    closeDrawer();
    highlightNav(path);
    window.scrollTo({ top: 0 });
    page.focus({ preventScroll: true });
  });
}

/* -------------------------------------------------------------------------
   Command menu
   ------------------------------------------------------------------------- */
async function searchSources(query) {
  const term = query.trim().toLowerCase();

  const pages = NAV.flatMap((group) => group.items)
    .filter((item) => !term || item.label.toLowerCase().includes(term))
    .map((item) => ({
      group: "Go to",
      label: item.label,
      icon: item.icon,
      action: () => navigate(item.path),
    }));

  if (!term) return pages;

  const results = [...pages];

  // Records are searched only once the operator types something: a command
  // menu that fetches every lead on open is a slow command menu.
  const [leads, conversations, appointments] = await Promise.all([
    load.leads({ limit: 200 }).catch(() => []),
    load.conversations().catch(() => []),
    load.appointments({ limit: 200 }).catch(() => []),
  ]);

  leads
    .filter(
      (lead) =>
        lead.display_name.toLowerCase().includes(term) ||
        (lead.treatment_label || "").toLowerCase().includes(term)
    )
    .slice(0, 6)
    .forEach((lead) =>
      results.push({
        group: "Leads",
        label: lead.display_name,
        meta: `${lead.treatment_label} · ${lead.score}/100`,
        icon: "leads",
        action: () => navigate(`/leads/${lead.lead_id}`),
      })
    );

  conversations
    .filter((row) => row.subject.toLowerCase().includes(term) || row.channel.toLowerCase().includes(term))
    .slice(0, 5)
    .forEach((row) =>
      results.push({
        group: "Conversations",
        label: row.subject,
        meta: row.channel,
        icon: "inbox",
        action: () => navigate("/conversations"),
      })
    );

  appointments
    .filter(
      (row) =>
        row.service.toLowerCase().includes(term) ||
        fmt.statusLabel(row.status).toLowerCase().includes(term)
    )
    .slice(0, 5)
    .forEach((row) =>
      results.push({
        group: "Appointments",
        label: `${fmt.titleCase(row.service)} · ${fmt.dateOnly(row.scheduled_for)}`,
        meta: fmt.statusLabel(row.status),
        icon: "calendar",
        action: () => navigate("/appointments"),
      })
    );

  return results;
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!isPaletteOpen() && page) openPalette();
  }
  // "/" is the other search key people reach for, but not while typing.
  if (
    event.key === "/" &&
    !isPaletteOpen() &&
    page &&
    !/^(input|textarea|select)$/i.test(document.activeElement?.tagName || "")
  ) {
    event.preventDefault();
    openPalette();
  }
});

boot();
