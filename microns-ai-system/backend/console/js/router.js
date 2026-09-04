/**
 * Hash routing.
 *
 * Hash rather than history API because the console is served as static files
 * from the backend: `#/leads/abc` needs no server rewrite rule, and a
 * bookmarked deep link survives a redeploy.
 */

const routes = new Map();
let notFound = null;
let onNavigate = null;
let currentPath = null;

export function defineRoute(pattern, handler) {
  routes.set(pattern, handler);
}

export function setNotFound(handler) {
  notFound = handler;
}

export function onRouteChange(handler) {
  onNavigate = handler;
}

export function currentRoute() {
  return currentPath;
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith("/") ? path : `/${path}`}`;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

function parse() {
  const raw = window.location.hash.replace(/^#/, "") || "/overview";
  const [path, query] = raw.split("?");
  return { path: path.replace(/\/+$/, "") || "/overview", params: new URLSearchParams(query || "") };
}

function match(path) {
  for (const [pattern, handler] of routes) {
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    const matched = patternParts.every((part, index) => {
      if (part.startsWith(":")) {
        params[part.slice(1)] = decodeURIComponent(pathParts[index]);
        return true;
      }
      return part === pathParts[index];
    });
    if (matched) return { handler, params, pattern };
  }
  return null;
}

async function resolve() {
  const { path, params } = parse();
  currentPath = path;
  const found = match(path);
  const context = { path, params: Object.fromEntries(params), route: found?.pattern || null };

  if (onNavigate) onNavigate({ ...context, routeParams: found?.params || {} });

  if (!found) {
    if (notFound) await notFound(context);
    return;
  }
  await found.handler({ ...context, ...found.params });
}

export function startRouter() {
  window.addEventListener("hashchange", resolve);
  return resolve();
}
