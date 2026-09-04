/**
 * Formatting.
 *
 * The rule this file exists to enforce: a value the engine does not have is
 * rendered as an em dash and a reason, never as a zero. "$0 recovered" and
 * "no recorded price" mean very different things to someone deciding whether
 * to trust this screen.
 */

export const EMPTY = "—";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencyPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export function money(cents, { precise = false } = {}) {
  if (cents === null || cents === undefined) return EMPTY;
  const value = cents / 100;
  return precise ? currencyPrecise.format(value) : currency.format(value);
}

export function number(value) {
  if (value === null || value === undefined) return EMPTY;
  return new Intl.NumberFormat("en-US").format(value);
}

export function percent(value, { digits = 0 } = {}) {
  if (value === null || value === undefined) return EMPTY;
  return `${Number(value).toFixed(digits)}%`;
}

/** Parses the backend's "…Z"-suffixed naive-UTC timestamps. */
export function parseDate(value) {
  if (!value) return null;
  const normalised = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateTime(value) {
  const date = parseDate(value);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dateOnly(value) {
  const date = parseDate(value);
  if (!date) return EMPTY;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function timeOnly(value) {
  const date = parseDate(value);
  if (!date) return EMPTY;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function relative(value) {
  const date = parseDate(value);
  if (!date) return EMPTY;
  return relativeFromMinutes((Date.now() - date.getTime()) / 60000);
}

export function relativeFromHours(hours) {
  if (hours === null || hours === undefined) return EMPTY;
  return relativeFromMinutes(hours * 60);
}

function relativeFromMinutes(minutes) {
  const past = minutes >= 0;
  const abs = Math.abs(minutes);
  let text;
  if (abs < 1) text = "just now";
  else if (abs < 60) text = `${Math.round(abs)} min`;
  else if (abs < 48 * 60) text = `${Math.round(abs / 60)} hr`;
  else text = `${Math.round(abs / 1440)} days`;
  if (text === "just now") return text;
  return past ? `${text} ago` : `in ${text}`;
}

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return EMPTY;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

export function initials(name) {
  if (!name) return "?";
  const parts = String(name)
    .replace(/[^\p{L}\p{N}\s.]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function titleCase(value) {
  if (!value) return EMPTY;
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sentence(value) {
  if (!value) return EMPTY;
  const text = String(value).replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function pluralise(count, singular, plural) {
  return `${number(count)} ${count === 1 ? singular : plural || `${singular}s`}`;
}

/** "Thursday, 3 September" — the date an owner would say out loud. */
export function today(date = new Date()) {
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** "Good morning" / "Good afternoon" / "Good evening" for the local clock. */
export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const BUDGET_LABELS = {
  "0-500": "Up to $500",
  "500-1000": "$500 – $1,000",
  "1000-2000": "$1,000 – $2,000",
  "2000+": "$2,000+",
};

export function budget(value) {
  if (!value) return EMPTY;
  return BUDGET_LABELS[value] || titleCase(value);
}

const TIMELINE_LABELS = {
  asap: "As soon as possible",
  "1-2_weeks": "Within 1–2 weeks",
  "1_month": "Within a month",
  browsing: "Just browsing",
};

export function timeline(value) {
  if (!value) return EMPTY;
  return TIMELINE_LABELS[value] || titleCase(value);
}

const STATUS_TONES = {
  // Appointments
  pending: "attention",
  confirmed: "positive",
  completed: "neutral",
  cancelled: "neutral",
  no_show: "critical",
  rescheduled: "info",
  // Leads
  new: "info",
  qualifying: "info",
  qualified: "accent",
  booked: "positive",
  nurture: "neutral",
  disqualified: "neutral",
  // Calls
  in_progress: "info",
  transferred: "attention",
  callback_requested: "attention",
  faq: "neutral",
  voicemail: "neutral",
  abandoned: "neutral",
};

export function statusTone(status) {
  return STATUS_TONES[status] || "neutral";
}

const STATUS_LABELS = {
  no_show: "Missed",
  pending: "Awaiting confirmation",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Moved",
  new: "New",
  qualifying: "In conversation",
  qualified: "Qualified",
  booked: "Booked",
  nurture: "Nurture",
  disqualified: "Not eligible",
  callback_requested: "Callback requested",
  in_progress: "In progress",
  transferred: "Transferred",
  faq: "Question answered",
  voicemail: "Voicemail",
  abandoned: "Hung up",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || titleCase(status);
}

/**
 * Intent is not a problem, so it does not get the problem colours. Red is
 * reserved for things that have gone wrong — a missed visit, a broken
 * connection, a promise past its deadline.
 */
export function temperatureTone(temperature) {
  return { hot: "accent", warm: "attention", cold: "neutral" }[temperature] || "neutral";
}

export function temperatureLabel(temperature) {
  return { hot: "High intent", warm: "Medium intent", cold: "Low intent" }[temperature] || EMPTY;
}
