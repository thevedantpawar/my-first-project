"use client";

import { useState } from "react";
import { site } from "@/lib/site";
import {
  WhatsAppIcon,
  PhoneIcon,
  MailIcon,
  MapPinIcon,
  ClockIcon,
  ArrowIcon,
} from "./Icons";
import { SectionHeading } from "./SectionHeading";
import { Reveal } from "./Reveal";

const goals = ["Weight loss", "Muscle & strength", "Medical fitness", "General health"];

export function Contact() {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    goal: goals[0],
    message: "",
  });
  const [sent, setSent] = useState(false);

  const waLink = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
    "Hi HealthRx! I'd like to know more about membership."
  )}`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // No backend in this static build — hand off to WhatsApp with the inquiry
    // pre-filled so the lead reaches the club instantly.
    const text = `New inquiry from the website:%0A%0AName: ${form.name}%0APhone: ${form.phone}%0AGoal: ${form.goal}%0AMessage: ${form.message}`;
    window.open(`https://wa.me/${site.whatsapp}?text=${text}`, "_blank");
    setSent(true);
  };

  const set = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <section id="contact" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 bg-[radial-gradient(45%_45%_at_20%_30%,rgba(183,255,0,0.08),transparent_60%)]" />
      <div className="shell relative">
        <SectionHeading
          center
          eyebrow="Get started"
          title={
            <>
              Book your free <span className="text-lime">consultation</span>
            </>
          }
          intro="Tell us your goal. We'll assess, prescribe and get you started — no pressure, no jargon."
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Form */}
          <Reveal>
            <form onSubmit={submit} className="glass space-y-4 p-6 sm:p-8">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Name"
                  value={form.name}
                  onChange={set("name")}
                  required
                  placeholder="Your name"
                />
                <Input
                  label="Phone / WhatsApp"
                  value={form.phone}
                  onChange={set("phone")}
                  required
                  type="tel"
                  placeholder="+91…"
                />
              </div>

              <div>
                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/50">
                  Primary goal
                </span>
                <div className="flex flex-wrap gap-2">
                  {goals.map((g) => (
                    <button
                      type="button"
                      key={g}
                      onClick={() => set("goal")(g)}
                      className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                        form.goal === g
                          ? "border-lime bg-lime text-ink"
                          : "border-white/15 text-white/60 hover:border-white/30"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/50">
                  Message{" "}
                  <span className="text-white/30">(optional)</span>
                </span>
                <textarea
                  value={form.message}
                  onChange={(e) => set("message")(e.target.value)}
                  rows={4}
                  placeholder="Anything we should know?"
                  className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-lime/50"
                />
              </div>

              <button type="submit" className="btn-primary w-full">
                {sent ? "Sent — we'll be in touch!" : "Send via WhatsApp"}
                <ArrowIcon className="h-4 w-4" />
              </button>
              <p className="text-center text-xs text-white/35">
                By submitting you agree to be contacted about your inquiry.
              </p>
            </form>
          </Reveal>

          {/* Details + map */}
          <Reveal delay={0.1}>
            <div className="flex h-full flex-col gap-4">
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="glass flex items-center gap-4 p-5 transition-colors hover:border-lime/40"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-lime text-ink">
                  <WhatsAppIcon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">
                    Chat on WhatsApp
                  </span>
                  <span className="block text-xs text-white/50">
                    Fastest way to reach us
                  </span>
                </span>
              </a>

              <div className="glass grid gap-4 p-5 sm:grid-cols-2">
                <Detail icon={<PhoneIcon className="h-4 w-4" />} label="Call" value={site.phone} href={`tel:${site.phone.replace(/\s/g, "")}`} />
                <Detail icon={<MailIcon className="h-4 w-4" />} label="Email" value={site.email} href={`mailto:${site.email}`} />
                <Detail icon={<MapPinIcon className="h-4 w-4" />} label="Visit" value={site.city} href={site.mapsLink} />
                <Detail icon={<ClockIcon className="h-4 w-4" />} label="Hours" value="5 AM – 11 PM" />
              </div>

              <div className="glass flex-1 overflow-hidden p-2">
                <iframe
                  title="HealthRx location on Google Maps"
                  src={site.mapsEmbed}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="h-full min-h-[220px] w-full rounded-2xl grayscale-[0.3] invert-[0.06]"
                />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/50">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-lime/50"
      />
    </label>
  );
}

function Detail({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-lime/25 bg-lime/10 text-lime">
        {icon}
      </span>
      <span>
        <span className="block text-[11px] uppercase tracking-wide text-white/40">
          {label}
        </span>
        <span className="block text-sm text-white/80">{value}</span>
      </span>
    </>
  );
  const cls = "flex items-center gap-3";
  return href ? (
    <a href={href} className={`${cls} transition-opacity hover:opacity-80`}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
