/** Presentation helpers. Nothing here invents a value it was not given. */

export function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function duration(ms) {
  if (ms === null || ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Status → the badge tone it should carry. Red only for genuine failure. */
export function statusTone(status) {
  switch (status) {
    case "active":
      return "ok";
    case "provisioning":
      return "accent";
    case "failed":
      return "danger";
    case "suspended":
      return "warn";
    default:
      return "";
  }
}

export function statusLabel(status) {
  const labels = {
    pending: "Not built yet",
    provisioning: "Building",
    active: "Running",
    suspended: "Paused",
    failed: "Needs attention",
    deprovisioning: "Shutting down",
    archived: "Archived",
  };
  return labels[status] || titleCase(status);
}
