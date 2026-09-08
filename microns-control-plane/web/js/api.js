/**
 * The API client.
 *
 * Every request sends the session cookie and every failure arrives as an
 * ApiError carrying the server's own message. The server writes those messages
 * to be read by a clinic owner, so they are shown as-is rather than replaced
 * with something vaguer.
 */

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    let detail = payload && payload.detail;
    // FastAPI validation errors arrive as a list of per-field objects.
    if (Array.isArray(detail)) {
      detail = detail.map((d) => d.msg || "Invalid value").join(". ");
    }
    throw new ApiError(response.status, detail);
  }
  return payload;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  patch: (path, body) => request("PATCH", path, body),

  session: () => request("GET", "/api/auth/session"),
  login: (email, password) => request("POST", "/api/auth/login", { email, password }),
  signup: (payload) => request("POST", "/api/auth/signup", payload),
  logout: () => request("POST", "/api/auth/logout"),
  requestReset: (email) => request("POST", "/api/auth/password/reset-request", { email }),
  confirmReset: (token, password) =>
    request("POST", "/api/auth/password/reset", { token, password }),
  changePassword: (current_password, new_password) =>
    request("POST", "/api/auth/password/change", { current_password, new_password }),

  clinics: () => request("GET", "/api/clinics"),
  clinic: (id) => request("GET", `/api/clinics/${id}`),
  createClinic: (payload) => request("POST", "/api/clinics", payload),
  updateClinic: (id, payload) => request("PATCH", `/api/clinics/${id}`, payload),
  provision: (id) => request("POST", `/api/clinics/${id}/provision`),
  encryptionKey: (id) => request("GET", `/api/clinics/${id}/encryption-key`),
  confirmKeyBackup: (id) => request("POST", `/api/clinics/${id}/confirm-key-backup`),

  plans: () => request("GET", "/api/billing/plans"),
  subscription: () => request("GET", "/api/billing/subscription"),
  checkout: (plan) => request("POST", "/api/billing/checkout", { plan }),
  portal: () => request("POST", "/api/billing/portal"),

  health: () => request("GET", "/health"),
};
