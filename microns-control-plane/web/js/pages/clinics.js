/** The clinic list, the create form, and one clinic's detail view. */

import { api, ApiError } from "../api.js";
import { clear, el, field, select, toast } from "../dom.js";
import * as fmt from "../format.js";
import { go } from "../router.js";
import { appShell, pageHead } from "../shell.js";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Europe/London",
  "Asia/Kolkata",
  "Australia/Sydney",
];

/** The ten provisioning steps, in the order the provisioner runs them. */
const STEPS = [
  ["create_project", "Creating the project"],
  ["create_database", "Creating the database"],
  ["attach_volume", "Attaching a persistent volume"],
  ["deploy_database", "Starting the database"],
  ["generate_secrets", "Generating encryption keys"],
  ["create_service", "Creating the engine"],
  ["set_variables", "Applying production settings"],
  ["assign_domain", "Assigning a web address"],
  ["deploy_service", "Deploying the engine"],
  ["verify_health", "Checking it responds"],
];

function statusBadge(clinic) {
  const tone = fmt.statusTone(clinic.status);
  return el(`span.badge${tone ? `.badge--${tone}` : ""}`, {
    text: fmt.statusLabel(clinic.status),
  });
}

function clinicCard(clinic) {
  const actions = el("div.clinic-card__actions", {}, [
    el("a.btn.btn--secondary", { href: `#/clinic/${clinic.id}`, text: "Manage" }),
    clinic.console_url && clinic.status === "active"
      ? el("a.btn.btn--quiet", {
          href: clinic.console_url,
          text: "Open console",
          target: "_blank",
          rel: "noopener noreferrer",
        })
      : null,
  ]);

  return el("article.card.clinic-card", {}, [
    el("div.clinic-card__top", {}, [
      el("div", {}, [
        el("div.clinic-card__name", { text: clinic.name }),
        el("div.clinic-card__slug", { text: clinic.slug }),
      ]),
      statusBadge(clinic),
    ]),
    clinic.status_detail ? el("p.small.muted", { text: clinic.status_detail }) : null,
    clinic.status === "active" && !clinic.key_backup_confirmed
      ? el("div.note.note--warn", {
          text: "Back up this clinic's encryption key. Without it, its records cannot be recovered.",
          style: "margin: 0",
        })
      : null,
    actions,
  ]);
}

export async function clinicList(user) {
  const content = el("div.page");
  appShell(user, content);

  content.append(
    pageHead(
      "Clinics",
      "Each clinic runs its own engine, its own database and its own encryption key.",
      el("a.btn.btn--primary", { href: "#/new-clinic", text: "Add a clinic" }),
    ),
  );

  const body = el("div");
  content.append(body);

  let clinics = [];
  let subscription = null;
  try {
    [clinics, subscription] = await Promise.all([api.clinics(), api.subscription()]);
  } catch (error) {
    body.append(el("div.note.note--error", { text: error.message }));
    return;
  }

  if (subscription && !subscription.is_entitled) {
    body.append(
      el("div.note.note--warn", {}, [
        "This account has no active subscription. ",
        el("a", { href: "#/billing", text: "Choose a plan" }),
        " to add and run clinics.",
      ]),
    );
  }

  if (!clinics.length) {
    body.append(
      el("div.empty", {}, [
        el("h3", { text: "No clinics yet" }),
        el("p", {
          text:
            "Adding a clinic builds it its own engine — a private database with a persistent " +
            "volume, its own encryption key, and production safety settings applied from the start.",
        }),
        el("a.btn.btn--primary", { href: "#/new-clinic", text: "Add your first clinic" }),
      ]),
    );
    return;
  }

  body.append(el("div.cards.cards--2", {}, clinics.map(clinicCard)));

  // Poll while anything is mid-build, so the list settles without a refresh.
  if (clinics.some((c) => c.status === "provisioning")) {
    setTimeout(() => {
      if (window.location.hash.includes("clinics")) clinicList(user);
    }, 5000);
  }
}

export async function newClinic(user) {
  const content = el("div.page");
  appShell(user, content);
  content.append(pageHead("Add a clinic", "You can change any of this later."));

  const note = el("div.note.note--error", { hidden: true, role: "alert" });
  const name = field("Clinic name", { required: true, autocomplete: "organization" });
  const timezone = select(
    "Time zone",
    TIMEZONES.map((tz) => ({ value: tz, label: tz.replace("_", " ") })),
  );
  const contact = field("Contact email", { type: "email" }, "Where the clinic hears from you.");
  const phone = field("Clinic phone", { type: "tel" });
  const open = field("Opens at", { type: "number", min: 0, max: 23, value: 9 });
  const close = field("Closes at", { type: "number", min: 1, max: 24, value: 18 });
  const bookingUrl = field("Booking page", { type: "url" }, "Optional. Used in patient messages.");

  const submit = el("button.btn.btn--primary", { type: "submit", text: "Create clinic" });

  const form = el("form.card", {}, [
    note,
    name.node,
    timezone.node,
    contact.node,
    phone.node,
    el("div.field-row", {}, [open.node, close.node]),
    bookingUrl.node,
    el("div.row", {}, [submit, el("a.btn.btn--quiet", { href: "#/clinics", text: "Cancel" })]),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    note.hidden = true;
    try {
      const clinic = await api.createClinic({
        name: name.input.value,
        timezone: timezone.input.value,
        contact_email: contact.input.value || null,
        phone: phone.input.value || null,
        booking_url: bookingUrl.input.value || null,
        open_hour: Number(open.input.value),
        close_hour: Number(close.input.value),
      });
      toast("Clinic created.", "ok");
      go(`clinic/${clinic.id}`);
    } catch (error) {
      note.textContent = error instanceof ApiError ? error.message : "Could not create the clinic.";
      note.hidden = false;
      submit.disabled = false;
    }
  });

  content.append(form);
}

function stepsView(clinic) {
  const byStep = new Map();
  for (const event of clinic.provisioning || []) {
    // Later events supersede earlier ones for the same step, so a retry shows
    // its final outcome rather than the failure it replaced.
    byStep.set(event.step, event);
  }

  return el(
    "div.steps",
    {},
    STEPS.map(([key, label], index) => {
      const event = byStep.get(key);
      const outcome = event ? event.outcome : null;
      const state =
        outcome === "succeeded"
          ? "done"
          : outcome === "failed"
            ? "failed"
            : outcome === "started"
              ? "running"
              : "";
      const glyph = state === "done" ? "✓" : state === "failed" ? "!" : String(index + 1);

      return el(`div.step${state ? `.step--${state}` : ""}`, {}, [
        el("span.step__dot", { text: glyph, "aria-hidden": "true" }),
        el("div", {}, [
          el("div.step__label", { text: label }),
          event && event.message && outcome === "failed"
            ? el("div.step__detail", { text: event.message })
            : null,
        ]),
        el("span.step__time", { text: event ? fmt.duration(event.duration_ms) : "" }),
      ]);
    }),
  );
}

async function revealKey(clinic, host) {
  clear(host);
  host.append(el("p.small.muted", { text: "Retrieving…" }));
  try {
    const payload = await api.encryptionKey(clinic.id);
    clear(host);
    host.append(
      el("div.note.note--warn", { text: payload.warning }),
      el("p.code", { text: payload.encryption_key }),
      el("div.row", {}, [
        el("button.btn.btn--secondary", {
          type: "button",
          text: "Copy",
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(payload.encryption_key);
              toast("Copied.", "ok");
            } catch {
              toast("Could not copy — select the key and copy it manually.", "error");
            }
          },
        }),
        clinic.key_backup_confirmed
          ? null
          : el("button.btn.btn--primary", {
              type: "button",
              text: "I have stored it safely",
              onclick: async () => {
                await api.confirmKeyBackup(clinic.id);
                toast("Noted.", "ok");
                go(`clinic/${clinic.id}`);
                window.location.reload();
              },
            }),
      ]),
    );
  } catch (error) {
    clear(host);
    host.append(el("div.note.note--error", { text: error.message }));
  }
}

export async function clinicDetail(user, id) {
  const content = el("div.page");
  appShell(user, content);

  let clinic;
  try {
    clinic = await api.clinic(id);
  } catch (error) {
    content.append(
      pageHead("Clinic"),
      el("div.note.note--error", { text: error.message }),
      el("a.btn.btn--secondary", { href: "#/clinics", text: "Back to clinics" }),
    );
    return;
  }

  const actions = el("div.row", {}, [
    clinic.console_url && clinic.status === "active"
      ? el("a.btn.btn--primary", {
          href: clinic.console_url,
          text: "Open console",
          target: "_blank",
          rel: "noopener noreferrer",
        })
      : null,
    clinic.status === "pending" || clinic.status === "failed"
      ? el("button.btn.btn--primary", {
          type: "button",
          text: clinic.status === "failed" ? "Retry build" : "Build the engine",
          onclick: async (event) => {
            event.target.disabled = true;
            try {
              await api.provision(clinic.id);
              toast("Building. This takes a couple of minutes.", "ok");
              clinicDetail(user, id);
            } catch (error) {
              toast(error.message, "error");
              event.target.disabled = false;
            }
          },
        })
      : null,
  ]);

  content.append(pageHead(clinic.name, null, actions));
  content.append(el("div.row", {}, [statusBadge(clinic), el("span.code", { text: clinic.slug })]));

  if (clinic.status_detail) {
    const tone = clinic.status === "failed" ? "error" : "warn";
    content.append(el(`div.note.note--${tone}`, { text: clinic.status_detail, style: "margin-top: var(--s4)" }));
  }

  // --- Build progress ---
  if (clinic.status !== "pending") {
    content.append(
      el("section.section", {}, [
        el("div.section__head", {}, [el("h2", { text: "Build" })]),
        stepsView(clinic),
      ]),
    );
  }

  // --- Details ---
  content.append(
    el("section.section", {}, [
      el("div.section__head", {}, [el("h2", { text: "Details" })]),
      el("div.card", {}, [
        el("div.kv", {}, [
          row("Time zone", clinic.timezone),
          row("Contact", clinic.contact_email || "—"),
          row("Phone", clinic.phone || "—"),
          row("Created", fmt.date(clinic.created_at)),
          row("Built", clinic.provisioned_at ? fmt.date(clinic.provisioned_at) : "Not yet"),
          clinic.engine_url
            ? el("div.kv__row", {}, [
                el("span.kv__key", { text: "Address" }),
                el("a", {
                  href: clinic.engine_url,
                  text: clinic.engine_url,
                  target: "_blank",
                  rel: "noopener noreferrer",
                }),
              ])
            : null,
        ]),
      ]),
    ]),
  );

  // --- Encryption key ---
  if (clinic.status === "active" || clinic.encryption_key) {
    const keyHost = el("div.stack");
    content.append(
      el("section.section", {}, [
        el("div.section__head", {}, [
          el("h2", { text: "Encryption key" }),
          clinic.key_backup_confirmed
            ? el("span.badge.badge--ok", { text: "Backed up" })
            : el("span.badge.badge--warn", { text: "Not backed up" }),
        ]),
        el("div.card", {}, [
          el("p.small.muted", {
            text:
              "This key decrypts every patient record in this clinic. We hold a copy so the " +
              "clinic can be rebuilt, but you should keep your own in a password manager. " +
              "Every time it is shown here, the access is recorded.",
          }),
          el("div.row", { style: "margin-top: var(--s4)" }, [
            el("button.btn.btn--danger", {
              type: "button",
              text: "Show the key",
              onclick: () => revealKey(clinic, keyHost),
            }),
          ]),
          keyHost,
        ]),
      ]),
    );
  }

  content.append(
    el("div", { style: "margin-top: var(--s6)" }, [
      el("a.btn.btn--quiet", { href: "#/clinics", text: "← All clinics" }),
    ]),
  );

  if (clinic.status === "provisioning") {
    setTimeout(() => {
      if (window.location.hash.includes(id)) clinicDetail(user, id);
    }, 4000);
  }
}

function row(key, value) {
  return el("div.kv__row", {}, [
    el("span.kv__key", { text: key }),
    el("span", { text: String(value) }),
  ]);
}
