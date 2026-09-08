/** Sign in, sign up, and password reset. */

import { api, ApiError } from "../api.js";
import { el, field, toast } from "../dom.js";
import { go } from "../router.js";
import { authShell } from "../shell.js";

function errorNote() {
  return el("div.note.note--error", { hidden: true, role: "alert" });
}

function show(note, message) {
  note.textContent = message;
  note.hidden = false;
}

/**
 * Wire a form so it cannot be double-submitted.
 *
 * Signup and checkout both create things; a second click while the first is in
 * flight is the cheapest way to end up with two of them.
 */
function onSubmit(form, button, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "Working…";
    try {
      await handler();
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}

export function signIn() {
  const note = errorNote();
  const email = field("Email", { type: "email", required: true, autocomplete: "email" });
  const password = field("Password", {
    type: "password",
    required: true,
    autocomplete: "current-password",
  });
  const submit = el("button.btn.btn--primary.btn--block", { type: "submit", text: "Sign in" });

  const form = el("form", {}, [note, email.node, password.node, submit]);

  onSubmit(form, submit, async () => {
    note.hidden = true;
    try {
      await api.login(email.input.value, password.input.value);
      go("clinics");
      window.location.reload();
    } catch (error) {
      show(note, error instanceof ApiError ? error.message : "Could not sign in.");
    }
  });

  authShell(
    "Sign in",
    "Manage your clinics and their revenue engines.",
    form,
    el("div.stack", {}, [
      el("a", { href: "#/signup", text: "Create an account" }),
      el("a", { href: "#/forgot", text: "Forgot your password?" }),
    ]),
  );
}

export function signUp() {
  const note = errorNote();
  const accountName = field("Practice or group name", { required: true, autocomplete: "organization" });
  const name = field("Your name", { autocomplete: "name" });
  const email = field("Email", { type: "email", required: true, autocomplete: "email" });
  const password = field(
    "Password",
    { type: "password", required: true, minlength: 12, autocomplete: "new-password" },
    "At least 12 characters. Length matters more than symbols.",
  );
  const submit = el("button.btn.btn--primary.btn--block", { type: "submit", text: "Create account" });

  const form = el("form", {}, [note, accountName.node, name.node, email.node, password.node, submit]);

  onSubmit(form, submit, async () => {
    note.hidden = true;
    try {
      await api.signup({
        account_name: accountName.input.value,
        name: name.input.value || null,
        email: email.input.value,
        password: password.input.value,
      });
      go("clinics");
      window.location.reload();
    } catch (error) {
      show(note, error instanceof ApiError ? error.message : "Could not create the account.");
    }
  });

  authShell(
    "Create your account",
    "One account, one or more clinics.",
    form,
    el("span", {}, ["Already have one? ", el("a", { href: "#/signin", text: "Sign in" })]),
  );
}

export function forgotPassword() {
  const note = el("div.note.note--accent", { hidden: true, role: "status" });
  const email = field("Email", { type: "email", required: true, autocomplete: "email" });
  const submit = el("button.btn.btn--primary.btn--block", { type: "submit", text: "Send reset link" });
  const form = el("form", {}, [note, email.node, submit]);

  onSubmit(form, submit, async () => {
    await api.requestReset(email.input.value);
    // Always the same message: whether the address has an account is not
    // something this page will tell anybody.
    note.textContent = "If that address has an account, a reset link is on its way.";
    note.hidden = false;
    form.reset();
  });

  authShell(
    "Reset your password",
    null,
    form,
    el("a", { href: "#/signin", text: "Back to sign in" }),
  );
}

export function resetPassword({ query }) {
  const token = query.get("token") || "";
  const note = errorNote();
  const password = field(
    "New password",
    { type: "password", required: true, minlength: 12, autocomplete: "new-password" },
    "At least 12 characters.",
  );
  const submit = el("button.btn.btn--primary.btn--block", { type: "submit", text: "Set new password" });
  const form = el("form", {}, [note, password.node, submit]);

  onSubmit(form, submit, async () => {
    note.hidden = true;
    try {
      await api.confirmReset(token, password.input.value);
      toast("Password changed. Sign in with your new password.", "ok");
      go("signin");
    } catch (error) {
      show(note, error instanceof ApiError ? error.message : "Could not reset the password.");
    }
  });

  if (!token) {
    authShell(
      "Reset your password",
      null,
      el("div.note.note--error", {
        text: "This reset link is incomplete. Request a new one.",
      }),
      el("a", { href: "#/forgot", text: "Request a new link" }),
    );
    return;
  }

  authShell("Choose a new password", "This signs you out everywhere else.", form);
}
