"use client";

import { useEffect, useState } from "react";
import { site } from "@/lib/site";
import { WhatsAppIcon } from "./Icons";

export function WhatsAppFloat() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const waLink = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
    "Hi HealthRx! I'd like to book a tour."
  )}`;

  return (
    <a
      href={waLink}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      className={`fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-lime text-ink shadow-glow transition-all duration-300 hover:scale-105 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <span className="absolute inset-0 animate-ping rounded-full bg-lime/40" />
      <WhatsAppIcon className="relative h-7 w-7" />
    </a>
  );
}
