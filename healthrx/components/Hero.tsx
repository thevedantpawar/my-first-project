"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { site, stats } from "@/lib/site";
import { ArrowIcon, WhatsAppIcon } from "./Icons";
import { Particles } from "./Particles";
import { Counter } from "./Counter";

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const yText = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -80]);
  const yArt = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 120]);
  const waLink = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
    "Hi HealthRx! I'd like to book a tour."
  )}`;

  return (
    <section
      id="top"
      ref={ref}
      className="relative flex min-h-[100svh] items-center overflow-hidden pt-24"
    >
      {/* Background layers */}
      <div className="absolute inset-0 bg-grid-lines bg-[size:56px_56px] opacity-60" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_20%,rgba(183,255,0,0.14),transparent_60%)]" />
      <div className="absolute -left-40 top-1/3 h-[420px] w-[420px] rounded-full bg-lime/10 blur-[120px]" />
      <Particles />

      <div className="shell relative z-10 grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Copy */}
        <motion.div style={{ y: yText }}>
          <motion.span
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="eyebrow"
          >
            <span className="inline-block h-1.5 w-1.5 animate-heartbeat rounded-full bg-lime" />
            Premium Medical Fitness · {site.city}
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-6 font-display text-5xl font-bold leading-[0.98] tracking-tight sm:text-6xl xl:text-7xl"
          >
            We Prescribe
            <br />
            <span className="text-lime">Health.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.32 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-white/65"
          >
            Nashik&apos;s science-driven fitness club where every program is
            assessed, prescribed and progressed like medicine. Training,
            nutrition and transformation — backed by data.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.44 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <a href="#plans" className="btn-primary">
              View Membership
              <ArrowIcon className="h-4 w-4" />
            </a>
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
            >
              <WhatsAppIcon className="h-4 w-4" />
              Chat on WhatsApp
            </a>
          </motion.div>

          {/* Stats */}
          <div className="mt-12 grid max-w-xl grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="font-display text-3xl font-bold text-white">
                  <Counter to={s.value} suffix={s.suffix} />
                </div>
                <div className="mt-1 text-xs leading-tight text-white/45">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 3D-style hero art */}
        <motion.div
          style={{ y: yArt }}
          className="relative mx-auto hidden aspect-square w-full max-w-md lg:block"
        >
          <HeroArt />
        </motion.div>
      </div>

      {/* Scroll cue */}
      <div className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-white/40 lg:flex">
        <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
        <span className="h-9 w-5 rounded-full border border-white/20 p-1">
          <span className="mx-auto block h-2 w-0.5 animate-bounce rounded-full bg-lime" />
        </span>
      </div>
    </section>
  );
}

/** Rotating 3D dumbbell ring + heartbeat motif, built with CSS transforms + SVG. */
function HeroArt() {
  return (
    <div
      className="relative h-full w-full [perspective:1200px]"
      style={{ transformStyle: "preserve-3d" }}
    >
      {/* Concentric pulse rings */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="absolute h-64 w-64 rounded-full border border-lime/30 animate-pulse-ring" />
        <span
          className="absolute h-64 w-64 rounded-full border border-lime/30 animate-pulse-ring"
          style={{ animationDelay: "1.3s" }}
        />
      </div>

      {/* Rotating dashed orbit */}
      <div className="absolute inset-6 animate-spin-slow rounded-full border border-dashed border-white/10" />

      {/* Glass core */}
      <div className="absolute inset-10 flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] shadow-glow-lg backdrop-blur-xl">
        {/* Floating 3D dumbbell */}
        <div className="animate-float-slow [transform-style:preserve-3d]">
          <svg
            viewBox="0 0 200 120"
            className="h-40 w-56 drop-shadow-[0_12px_30px_rgba(183,255,0,0.25)]"
            role="img"
            aria-label="3D dumbbell"
          >
            <defs>
              <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e9ffb0" />
                <stop offset="0.5" stopColor="#b7ff00" />
                <stop offset="1" stopColor="#6f9c00" />
              </linearGradient>
              <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3a3f33" />
                <stop offset="1" stopColor="#15170f" />
              </linearGradient>
            </defs>
            {/* bar */}
            <rect x="60" y="54" width="80" height="12" rx="6" fill="url(#steel)" />
            {/* plates */}
            <rect x="34" y="30" width="18" height="60" rx="8" fill="url(#chrome)" />
            <rect x="52" y="38" width="12" height="44" rx="6" fill="url(#steel)" />
            <rect x="148" y="30" width="18" height="60" rx="8" fill="url(#chrome)" />
            <rect x="136" y="38" width="12" height="44" rx="6" fill="url(#steel)" />
            {/* highlight */}
            <rect x="37" y="34" width="4" height="52" rx="2" fill="#ffffff" opacity="0.4" />
            <rect x="151" y="34" width="4" height="52" rx="2" fill="#ffffff" opacity="0.4" />
          </svg>
        </div>
      </div>

      {/* Heartbeat readout chip */}
      <div className="glass absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-3 px-4 py-2.5">
        <span className="animate-heartbeat text-lime">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M12 20s-7-4.35-9.5-8.5C1 8.5 2.5 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.5 0 5 3.5 3.5 6.5C19 15.65 12 20 12 20Z" />
          </svg>
        </span>
        <svg viewBox="0 0 90 24" className="h-5 w-24 text-lime">
          <path
            d="M2 12h14l4-8 6 16 4-12 3 6 4-2h50"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-xs font-medium text-white/70">62 bpm</span>
      </div>
    </div>
  );
}
