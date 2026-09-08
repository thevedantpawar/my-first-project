/** Account settings: who you are, and changing your password. */

import { api, ApiError } from "../api.js";
import { el, field, toast } from "../dom.js";
import { appShell, pageHead } from "../shell.js";

export async function settings(user) {
  const content = el("div.page");
  appShell(user, content);
  content.append(pageHead("Settings"));

  content.append(
    el("section.section", {}, [
      el("div.section__head", {}, [el("h2", { text: "Account" })]),
      el("div.card", {}, [
        el("div.kv", {}, [
          kv("Practice", user.account_name),
          kv("Name", user.name || "—"),
          kv("Email", user.email),
          kv("Role", user.is_owner ? "Owner" : "Member"),
        ]),
      ]),
    ]),
  );

  // --- Password ---
  const note = el("div.note.note--error", { hidden: true, role: "alert" });
  const currentPassword = field("Current password", {
    type: "password",
    required: true,
    autocomplete: "current-password",
  });
  const newPassword = field(
    "New password",
    { type: "password", required: true, minlength: 12, autocomplete: "new-password" },
    "At least 12 characters. Changing it signs out your other devices.",
  );
  const submit = el("button.btn.btn--primary", { type: "submit", text: "Change password" });

  const form = el("form.card", {}, [note, currentPassword.node, newPassword.node, submit]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    note.hidden = true;
    try {
      await api.changePassword(currentPassword.input.value, newPassword.input.value);
      toast("Password changed. Other devices have been signed out.", "ok");
      form.reset();
    } catch (error) {
      note.textContent = error instanceof ApiError ? error.message : "Could not change the password.";
      note.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  content.append(
    el("section.section", {}, [
      el("div.section__head", {}, [el("h2", { text: "Password" })]),
      form,
    ]),
  );

  // --- Sign out ---
  content.append(
    el("section.section", {}, [
      el("div.section__head", {}, [el("h2", { text: "Session" })]),
      el("div.card", {}, [
        el("button.btn.btn--secondary", {
          type: "button",
          text: "Sign out",
          onclick: async () => {
            await api.logout();
            window.location.hash = "#/signin";
            window.location.reload();
          },
        }),
      ]),
    ]),
  );
}

function kv(key, value) {
  return el("div.kv__row", {}, [
    el("span.kv__key", { text: key }),
    el("span", { text: String(value) }),
  ]);
}
