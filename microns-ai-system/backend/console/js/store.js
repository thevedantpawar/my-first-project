/**
 * A very small shared cache.
 *
 * Several screens read the same three endpoints (overview, opportunities,
 * system). Fetching each of them once per navigation makes the console feel
 * slow for no reason, so results are cached briefly and invalidated whenever
 * the operator does something that could change them.
 */

import { api } from "./api.js";

const TTL_MS = 30_000;
const cache = new Map();
const listeners = new Set();

export const state = {
  /** Rolling window, in days, that every page respects. */
  windowDays: 30,
  system: null,
  opportunityCount: null,
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((listener) => listener(state));
}

export function setWindow(days) {
  if (state.windowDays === days) return;
  state.windowDays = days;
  invalidate();
  emit();
}

/** Drops cached reads. Call after any action that writes to the engine. */
export function invalidate(prefix) {
  if (!prefix) cache.clear();
  else [...cache.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => cache.delete(key));
}

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export const load = {
  overview: () => cached(`overview:${state.windowDays}`, () => api.overview(state.windowDays)),
  opportunities: () =>
    cached("opportunities", () => api.opportunities(120)).then((items) => {
      state.opportunityCount = items.length;
      emit();
      return items;
    }),
  conversations: () => cached("conversations", () => api.conversations(80)),
  leads: (params) => cached(`leads:${JSON.stringify(params || {})}`, () => api.leads(params)),
  lead: (id) => cached(`lead:${id}`, () => api.lead(id)),
  revenue: () => cached(`revenue:${state.windowDays}`, () => api.revenue(state.windowDays)),
  agents: () => cached(`agents:${state.windowDays}`, () => api.agents(state.windowDays)),
  workflows: () => cached("workflows", () => api.workflows()),
  insights: () => cached(`insights:${state.windowDays}`, () => api.insights(state.windowDays)),
  appointments: (params) =>
    cached(`appointments:${JSON.stringify(params || {})}`, () => api.appointments(params)),
  upcoming: () => cached("upcoming", () => api.appointmentsUpcoming(24 * 14)),
  commandCenter: () =>
    cached(`command-center:${state.windowDays}`, () => api.commandCenter(state.windowDays)),
  // Recovery is a slower loop than the rest of the console, so it keeps its
  // own ninety-day window rather than following the global one.
  recovery: () => cached("recovery", () => api.recovery(90)),
  activity: (limit = 40) => cached(`activity:${limit}`, () => api.activity(limit)),
  system: () =>
    cached("system", () => api.system()).then((value) => {
      state.system = value;
      emit();
      return value;
    }),
  timeline: (patientUuid) =>
    cached(`timeline:${patientUuid}`, () => api.patientTimeline(patientUuid)),
};
