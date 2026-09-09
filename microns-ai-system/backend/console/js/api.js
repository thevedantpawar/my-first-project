/**
 * API client.
 *
 * The console holds a staff token in `sessionStorage` and sends it as
 * `X-Staff-Token` — the same header the backend has always required. Session
 * storage, not local storage: the credential dies with the tab rather than
 * sitting on disk on a shared front-desk machine.
 *
 * There is no separate console session, no cookie and no new auth path. If
 * the token is wrong the backend audits the denial and answers 401, exactly
 * as it does for any other client.
 */

const TOKEN_KEY = "microns.console.staffToken";

export class ApiError extends Error {
  constructor(message, { status, requestId, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }

  get isAuth() {
    return this.status === 401 || this.status === 403;
  }
}

export const auth = {
  get token() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  },
  set token(value) {
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private browsing — the console still works, it just re-asks on reload */
    }
  },
  clear() {
    auth.token = "";
  },
};

/** Base URL of the API: the console is served from the backend itself. */
const BASE = window.location.origin;

async function request(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (auth.token) headers["X-Staff-Token"] = auth.token;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw new ApiError("Could not reach the Revenue Engine.", { status: 0 });
  }

  const requestId = response.headers.get("X-Request-ID");
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail =
      (payload && typeof payload === "object" && payload.detail) ||
      `Request failed (${response.status})`;
    throw new ApiError(typeof detail === "string" ? detail : "Request failed", {
      status: response.status,
      requestId,
      body: payload,
    });
  }

  return payload;
}

const qs = (params) => {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") search.set(key, value);
  });
  const string = search.toString();
  return string ? `?${string}` : "";
};

export const api = {
  request,

  // --- Public ---------------------------------------------------------- //
  health: () => request("/health"),

  // --- Console reads ---------------------------------------------------- //
  session: () => request("/console/api/session"),
  overview: (days = 30) => request(`/console/api/overview${qs({ days })}`),
  opportunities: (limit = 60) => request(`/console/api/opportunities${qs({ limit })}`),
  leads: (params) => request(`/console/api/leads${qs(params)}`),
  lead: (id) => request(`/console/api/leads/${id}`),
  conversations: (limit = 60) => request(`/console/api/conversations${qs({ limit })}`),
  revenue: (days = 30) => request(`/console/api/revenue${qs({ days })}`),
  agents: (days = 30) => request(`/console/api/agents${qs({ days })}`),
  workflows: () => request("/console/api/workflows"),
  insights: (days = 30) => request(`/console/api/insights${qs({ days })}`),
  system: () => request("/console/api/system"),

  // --- V4 owner projections --------------------------------------------- //
  commandCenter: (days = 30) => request(`/console/api/command-center${qs({ days })}`),
  recovery: (days = 90) => request(`/console/api/recovery${qs({ days })}`),
  activity: (limit = 40) => request(`/console/api/activity${qs({ limit })}`),

  // --- Existing engine endpoints, unchanged ----------------------------- //
  appointments: (params) => request(`/api/appointments${qs(params)}`),
  appointmentsUpcoming: (withinHours = 168) =>
    request(`/api/appointments/upcoming${qs({ within_hours: withinHours })}`),
  patientTimeline: (patientUuid, limit = 50) =>
    request(`/retention/events/${patientUuid}${qs({ limit })}`),
  retentionConfig: () => request("/retention/config"),

  // --- Actions (all pre-existing, audited endpoints) --------------------- //
  updateAppointmentStatus: (id, status, reason) =>
    request(`/api/appointments/${id}/status`, {
      method: "PATCH",
      body: { status, reason },
    }),
  triggerReview: (appointmentId) =>
    request("/retention/trigger-review", {
      method: "POST",
      body: { appointment_id: appointmentId },
    }),
  reactivatePatient: (patientUuid) =>
    request(`/retention/reactivate/${patientUuid}`, { method: "POST" }),

  // --- Test centre: the live qualification engine ------------------------ //
  chat: (message, sessionId) =>
    request("/leads/chat", {
      method: "POST",
      body: { message, session_id: sessionId },
    }),
};
