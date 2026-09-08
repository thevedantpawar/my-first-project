/**
 * Hash routing.
 *
 * A hash rather than the History API because this app is served by a catch-all
 * that returns the shell for any path — with real paths, a refresh on a deep
 * link works only as long as that catch-all keeps matching, and it is one
 * routing change away from not.
 */

const routes = new Map();
let notFound = null;

export function route(name, handler) {
  routes.set(name, handler);
}

export function setNotFound(handler) {
  notFound = handler;
}

export function current() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const segments = path.split("/").filter(Boolean);
  return {
    name: segments[0] || "",
    params: segments.slice(1),
    query: new URLSearchParams(query || ""),
  };
}

export function go(path, { replace = false } = {}) {
  const target = `#/${String(path).replace(/^#?\/?/, "")}`;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export async function render() {
  const { name, params, query } = current();
  const handler = routes.get(name) || notFound;
  if (handler) await handler({ params, query });
  window.scrollTo(0, 0);
}

export function start() {
  window.addEventListener("hashchange", () => {
    render().catch((error) => console.error("Route failed", error));
  });
  return render();
}
