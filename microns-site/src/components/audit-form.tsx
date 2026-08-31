"use client";

import { useId, useState } from "react";

type Errors = Partial<Record<string, string>>;

const leakOptions = [
  "Missed calls",
  "Slow replies to enquiries",
  "No-shows",
  "Reviews",
  "Not sure yet",
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(data: Record<string, string>): Errors {
  const e: Errors = {};
  if (!data.name.trim()) e.name = "We need a name to address the audit to.";
  if (!data.clinic.trim()) e.clinic = "Which clinic is this for?";
  if (!data.email.trim()) e.email = "We need an email to send the audit to.";
  else if (!emailPattern.test(data.email.trim()))
    e.email = "That email address doesn't look right.";
  if (!data.leak) e.leak = "Pick the one that worries you most. A guess is fine.";
  return e;
}

export function AuditForm() {
  const id = useId();
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const data = Object.fromEntries(
      [...fd.entries()].map(([k, v]) => [k, String(v)]),
    ) as Record<string, string>;

    const found = validate(data);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = form.querySelector<HTMLElement>(
        '[aria-invalid="true"], [aria-describedby$="-leak-error"]',
      );
      first?.focus();
      return;
    }

    setState("sending");
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      form.reset();
    } catch {
      setState("failed");
    }
  }

  if (state === "sent") {
    return (
      <div
        className="border border-mist p-8 md:p-10"
        role="status"
        aria-live="polite"
      >
        <h2 className="text-display-3">Got it.</h2>
        <p className="mt-5 max-w-[44ch] text-slate">
          You&rsquo;ll hear back within one working day, with the five numbers
          we can see from the outside and the one question we need answered to
          see the rest.
        </p>
      </div>
    );
  }

  const field =
    "mt-2 w-full border border-mist bg-transparent px-4 py-3.5 text-[1.0625rem] " +
    "min-h-[52px] transition-colors placeholder:text-slate/70 hover:border-slate " +
    "focus:border-micron aria-[invalid=true]:border-micron";

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-[46rem]">
      {/* Honeypot. Real people never see this; bots fill it in. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 overflow-hidden">
        <label htmlFor={`${id}-website2`}>Do not fill this in</label>
        <input
          id={`${id}-website2`}
          name="website2"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          id={`${id}-name`}
          name="name"
          label="Your name"
          autoComplete="name"
          error={errors.name}
          className={field}
        />
        <Field
          id={`${id}-clinic`}
          name="clinic"
          label="Clinic name"
          autoComplete="organization"
          error={errors.clinic}
          className={field}
        />
        <Field
          id={`${id}-email`}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email}
          className={field}
        />
        <Field
          id={`${id}-site`}
          name="site"
          label="Clinic website"
          hint="Optional"
          type="url"
          autoComplete="url"
          placeholder="https://"
          className={field}
        />
      </div>

      <fieldset className="mt-10 border-0 p-0">
        <legend className="text-[1.0625rem]">
          Where do you think you&rsquo;re losing the most?
        </legend>
        {errors.leak ? (
          <p id={`${id}-leak-error`} className="mt-2 text-meta text-micron">
            {errors.leak}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
          {leakOptions.map((o) => (
            <label
              key={o}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 pr-2"
            >
              <input
                type="radio"
                name="leak"
                value={o}
                aria-describedby={errors.leak ? `${id}-leak-error` : undefined}
                className="h-[18px] w-[18px] accent-[color:var(--color-micron)]"
              />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-10">
        <label htmlFor={`${id}-notes`} className="text-[1.0625rem]">
          Anything else worth knowing{" "}
          <span className="text-slate">— optional</span>
        </label>
        <textarea
          id={`${id}-notes`}
          name="notes"
          rows={4}
          className={`${field} resize-y`}
        />
      </div>

      {state === "failed" ? (
        <p role="alert" className="mt-8 border-l-2 border-micron pl-4 text-slate">
          That didn&rsquo;t send. Try again, or email{" "}
          <a
            className="text-ink underline underline-offset-[6px]"
            href="mailto:hello@microns.studio"
          >
            hello@microns.studio
          </a>{" "}
          and it will get the same answer.
        </p>
      ) : null}

      <button
        type="submit"
        data-cta="audit"
        disabled={state === "sending"}
        className="plausible-event-name=Audit+request mt-10 inline-flex min-h-[52px] w-full items-center justify-center bg-micron px-7 text-[1.0625rem] leading-none text-porcelain transition-colors hover:bg-[#1636b4] disabled:opacity-60 sm:w-auto"
      >
        {state === "sending" ? "Sending…" : "Request the audit"}
      </button>

      <p className="mt-5 text-meta text-slate">
        One reply from a person, not a mailing list. Nothing is shared with
        anyone.
      </p>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  hint,
  error,
  className,
  ...props
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
  className: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="text-[1.0625rem]">
        {label}
        {hint ? <span className="text-slate"> — {hint}</span> : null}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={className}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-2 text-meta text-micron">
          {error}
        </p>
      ) : null}
    </div>
  );
}
