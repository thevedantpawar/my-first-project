/**
 * A tiny hyperscript helper.
 *
 * Everything in this console builds DOM through `el()` rather than by
 * assigning innerHTML. That is not a style preference: names, treatment
 * interests and message previews come out of the database, and a template
 * literal is one apostrophe away from an injection. `textContent` cannot be
 * fooled.
 */

/**
 * @param {string} tag - "div", or "div.card.card--quiet", or "button.btn#save"
 * @param {object|null} props - attributes; `class`, `dataset`, `on*`, `html` excepted
 * @param {...(Node|string|number|null|undefined|Array)} children
 */
export function el(tag, props, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const node = document.createElement(name || "div");

  for (const token of rest) {
    if (token.startsWith(".")) node.classList.add(token.slice(1));
    else if (token.startsWith("#")) node.id = token.slice(1);
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class" || key === "className") {
        String(value).split(/\s+/).filter(Boolean).forEach((c) => node.classList.add(c));
      } else if (key === "dataset") {
        Object.entries(value).forEach(([k, v]) => {
          if (v !== null && v !== undefined) node.dataset[k] = v;
        });
      } else if (key === "style" && typeof value === "object") {
        Object.assign(node.style, value);
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === "text") {
        node.textContent = String(value);
      } else if (key === "svg") {
        // Icons only. Never used for values that came from the API.
        node.innerHTML = value;
      } else if (value === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }

  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  return append(node, children);
}

/**
 * Focusable elements inside a container, for dialog focus traps.
 *
 * Visibility is tested with `getClientRects()`, not `offsetParent`: every
 * dialog here sits inside a `position: fixed` layer, and `offsetParent` is
 * null for everything inside one — which would empty the trap and leave the
 * keyboard stranded outside the drawer.
 */
export function focusables(root) {
  return Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((node) => node.getClientRects().length > 0 || node === document.activeElement);
}
