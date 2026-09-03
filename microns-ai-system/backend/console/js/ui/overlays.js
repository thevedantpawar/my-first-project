/**
 * Drawer, modal, toasts and the command menu.
 *
 * All three dialogs share the same contract: they trap focus, close on Escape,
 * restore focus to whatever opened them, and are labelled for a screen reader.
 * A drawer that swallows the keyboard is not a premium detail, it is a bug.
 */

import { el, mount, clear, focusables } from "../dom.js";
import { icon } from "../icons.js";
import { button, iconButton } from "./components.js";

let root;

export function initOverlays(container) {
  root = container;
  root.appendChild(drawerNode);
  root.appendChild(modalNode);
  root.appendChild(paletteNode);
  root.appendChild(toastNode);
  document.addEventListener("keydown", onGlobalKeydown, true);
}

function onGlobalKeydown(event) {
  if (event.key === "Escape") {
    if (paletteNode.dataset.open === "true") return closePalette();
    if (modalNode.dataset.open === "true") return closeModal(false);
    if (drawerNode.dataset.open === "true") return closeDrawer();
  }
  if (event.key === "Tab") trapFocus(event);
}

function activePanel() {
  if (paletteNode.dataset.open === "true") return paletteNode.querySelector(".palette__panel");
  if (modalNode.dataset.open === "true") return modalNode.querySelector(".modal__panel");
  if (drawerNode.dataset.open === "true") return drawerNode.querySelector(".drawer__panel");
  return null;
}

function trapFocus(event) {
  const panel = activePanel();
  if (!panel) return;
  const items = focusables(panel);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

let lastFocused = null;

function rememberFocus() {
  lastFocused = document.activeElement;
}

function restoreFocus() {
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}

/* -------------------------------------------------------------------------
   Drawer — the console's default way of showing one record without losing
   the list behind it.
   ------------------------------------------------------------------------- */
const drawerTitle = el("h2.card-title", { id: "drawer-title" });
const drawerSubtitle = el("p.small.muted", { id: "drawer-subtitle" });
const drawerBody = el("div.drawer__body");
const drawerFooter = el("div.drawer__footer");

const drawerNode = el(
  "div.drawer",
  {
    dataset: { open: "false" },
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "drawer-title",
    "aria-hidden": "true",
  },
  el("div.drawer__scrim", { onClick: () => closeDrawer() }),
  el(
    "div.drawer__panel",
    null,
    el(
      "div.drawer__header",
      null,
      el("div.stack.stack--tight", { style: { minWidth: 0 } }, drawerTitle, drawerSubtitle),
      iconButton({ name: "close", label: "Close panel", onClick: () => closeDrawer() })
    ),
    drawerBody,
    drawerFooter
  )
);

export function openDrawer({ title, subtitle, body, footer }) {
  rememberFocus();
  drawerTitle.textContent = title || "";
  drawerSubtitle.textContent = subtitle || "";
  drawerSubtitle.hidden = !subtitle;
  mount(drawerBody, body || el("div"));
  clear(drawerFooter);
  if (footer && footer.length) {
    drawerFooter.hidden = false;
    footer.forEach((node) => drawerFooter.appendChild(node));
  } else {
    drawerFooter.hidden = true;
  }
  drawerNode.dataset.open = "true";
  drawerNode.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    const target = focusables(drawerNode.querySelector(".drawer__panel"))[0];
    if (target) target.focus();
  });
}

/** Replaces the drawer's body in place — used when its data finishes loading. */
export function setDrawerBody(body) {
  if (drawerNode.dataset.open !== "true") return;
  mount(drawerBody, body);
}

export function setDrawerFooter(nodes) {
  if (drawerNode.dataset.open !== "true") return;
  clear(drawerFooter);
  drawerFooter.hidden = !nodes || !nodes.length;
  (nodes || []).forEach((node) => drawerFooter.appendChild(node));
}

export function closeDrawer() {
  if (drawerNode.dataset.open !== "true") return;
  drawerNode.dataset.open = "false";
  drawerNode.setAttribute("aria-hidden", "true");
  restoreFocus();
}

export const isDrawerOpen = () => drawerNode.dataset.open === "true";

/* -------------------------------------------------------------------------
   Confirmation modal
   ------------------------------------------------------------------------- */
const modalTitle = el("h2.card-title", { id: "modal-title" });
const modalBody = el("p.small.secondary");
const modalActions = el("div.modal__actions");
let modalResolve = null;

const modalNode = el(
  "div.modal",
  {
    dataset: { open: "false" },
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "modal-title",
    "aria-hidden": "true",
  },
  el("div.modal__scrim", { onClick: () => closeModal(false) }),
  el("div.modal__panel", null, modalTitle, modalBody, modalActions)
);

/**
 * Anything that sends a message to a real person goes through here first.
 * @returns {Promise<boolean>}
 */
export function confirmAction({ title, body, confirmLabel = "Confirm", variant = "primary" }) {
  rememberFocus();
  modalTitle.textContent = title;
  modalBody.textContent = body || "";
  modalBody.hidden = !body;
  mount(
    modalActions,
    button({ label: "Cancel", variant: "ghost", onClick: () => closeModal(false) }),
    button({ label: confirmLabel, variant, onClick: () => closeModal(true) })
  );
  modalNode.dataset.open = "true";
  modalNode.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    const items = focusables(modalNode.querySelector(".modal__panel"));
    if (items.length) items[items.length - 1].focus();
  });
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function closeModal(result) {
  if (modalNode.dataset.open !== "true") return;
  modalNode.dataset.open = "false";
  modalNode.setAttribute("aria-hidden", "true");
  restoreFocus();
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

/* -------------------------------------------------------------------------
   Toasts
   ------------------------------------------------------------------------- */
const toastNode = el("div.toasts", { role: "status", "aria-live": "polite" });

export function toast({ title, body, variant = "info", timeout = 5000 }) {
  const node = el(
    "div",
    { class: `toast toast--${variant}` },
    el(
      "span",
      { style: { color: `var(--${variantColour(variant)})`, marginTop: "1px" } },
      icon(variant === "success" ? "checkCircle" : variant === "error" ? "alert" : "info", 16)
    ),
    el(
      "div.toast__text",
      null,
      el("div.toast__title", { text: title }),
      body ? el("div.toast__body", { text: body }) : null
    ),
    iconButton({ name: "close", label: "Dismiss", size: 14, onClick: () => node.remove() })
  );
  toastNode.appendChild(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

function variantColour(variant) {
  return { success: "positive", error: "critical", warning: "attention" }[variant] || "accent";
}

/* -------------------------------------------------------------------------
   Command menu (⌘K)
   ------------------------------------------------------------------------- */
const paletteInput = el("input.palette__input", {
  type: "text",
  placeholder: "Search pages, leads, appointments…",
  "aria-label": "Search",
  autocomplete: "off",
  spellcheck: "false",
});
const paletteResults = el("div.palette__results", { role: "listbox", id: "palette-results" });

const paletteNode = el(
  "div.palette",
  {
    dataset: { open: "false" },
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Search",
    "aria-hidden": "true",
  },
  el("div.palette__scrim", { onClick: () => closePalette() }),
  el("div.palette__panel", null, paletteInput, paletteResults)
);

let paletteSource = async () => [];
let paletteItems = [];
let paletteIndex = 0;

export function registerPaletteSource(fn) {
  paletteSource = fn;
}

export function openPalette() {
  rememberFocus();
  paletteNode.dataset.open = "true";
  paletteNode.setAttribute("aria-hidden", "false");
  paletteInput.value = "";
  runSearch("");
  requestAnimationFrame(() => paletteInput.focus());
}

export function closePalette() {
  if (paletteNode.dataset.open !== "true") return;
  paletteNode.dataset.open = "false";
  paletteNode.setAttribute("aria-hidden", "true");
  restoreFocus();
}

export const isPaletteOpen = () => paletteNode.dataset.open === "true";

let searchToken = 0;

async function runSearch(query) {
  const token = ++searchToken;
  const results = await paletteSource(query);
  if (token !== searchToken) return;
  paletteItems = results;
  paletteIndex = 0;
  renderPalette();
}

function renderPalette() {
  clear(paletteResults);
  if (!paletteItems.length) {
    paletteResults.appendChild(
      el("p.small.muted", { style: { padding: "var(--space-5)" }, text: "No matches." })
    );
    return;
  }

  let currentGroup = null;
  paletteItems.forEach((item, index) => {
    if (item.group !== currentGroup) {
      currentGroup = item.group;
      paletteResults.appendChild(el("p.eyebrow.palette__group", { text: currentGroup }));
    }
    paletteResults.appendChild(
      el(
        "button.palette__item",
        {
          type: "button",
          role: "option",
          "aria-selected": String(index === paletteIndex),
          dataset: { active: String(index === paletteIndex) },
          onClick: () => choose(index),
          onMouseenter: () => {
            paletteIndex = index;
            renderPalette();
          },
        },
        icon(item.icon || "arrowRight", 16),
        el("span", { text: item.label }),
        item.meta ? el("span.palette__item__meta", { text: item.meta }) : null
      )
    );
  });
}

function choose(index) {
  const item = paletteItems[index];
  if (!item) return;
  closePalette();
  item.action();
}

paletteInput.addEventListener("input", (event) => runSearch(event.target.value.trim()));

paletteInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    paletteIndex = Math.min(paletteIndex + 1, paletteItems.length - 1);
    renderPalette();
    scrollActiveIntoView();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    paletteIndex = Math.max(paletteIndex - 1, 0);
    renderPalette();
    scrollActiveIntoView();
  } else if (event.key === "Enter") {
    event.preventDefault();
    choose(paletteIndex);
  }
});

function scrollActiveIntoView() {
  const active = paletteResults.querySelector('[data-active="true"]');
  if (active) active.scrollIntoView({ block: "nearest" });
}
