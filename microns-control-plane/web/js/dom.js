/**
 * A very small DOM builder.
 *
 * Everything is created with createElement and textContent — there is no
 * innerHTML anywhere in this app. Clinic names, status messages and provisioning
 * errors all pass through here, and some of them originate outside the product
 * (a Railway error message, for one). Building nodes rather than strings means
 * none of it can ever be parsed as markup.
 */

export function el(spec, props = {}, children = []) {
  const [tag, ...classes] = String(spec).split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") node.textContent = String(value);
    else if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== "list" && key !== "type") {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node) {
  const app = document.getElementById("app");
  clear(app);
  app.removeAttribute("aria-busy");
  app.append(node);
  return app;
}

export function toast(message, kind = "") {
  const host = document.getElementById("toasts");
  const node = el(`div.toast${kind ? `.toast--${kind}` : ""}`, { text: message, role: "status" });
  host.append(node);
  setTimeout(() => node.remove(), kind === "error" ? 7000 : 4000);
}

/** A field with a label, an input and an optional hint. */
export function field(label, props = {}, hint = null) {
  const id = props.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  const input = el("input.field__input", { ...props, id });
  return {
    input,
    node: el("div.field", {}, [
      el("label.field__label", { text: label, for: id }),
      input,
      hint ? el("p.field__hint", { text: hint }) : null,
    ]),
  };
}

export function select(label, options, props = {}) {
  const id = props.id || `s-${Math.random().toString(36).slice(2, 9)}`;
  const node = el("select.field__select", { ...props, id });
  for (const option of options) {
    node.append(el("option", { value: option.value, text: option.label }));
  }
  return {
    input: node,
    node: el("div.field", {}, [el("label.field__label", { text: label, for: id }), node]),
  };
}
