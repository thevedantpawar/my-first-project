import { nav, site } from "@/lib/site";
import {
  InstagramIcon,
  YoutubeIcon,
  FacebookIcon,
  MapPinIcon,
} from "./Icons";

export function Footer() {
  return (
    <footer className="relative border-t border-white/10 bg-ink">
      <div className="shell py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="font-display text-2xl font-bold tracking-tight">
              Health<span className="text-lime">Rx</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/50">
              {site.tagline}. Nashik&apos;s premium, science-driven medical
              fitness club — helping beginners, professionals and transformation
              clients get measurably healthier.
            </p>
            <div className="mt-6 flex gap-3">
              {[
                { href: site.socials.instagram, icon: InstagramIcon, label: "Instagram" },
                { href: site.socials.youtube, icon: YoutubeIcon, label: "YouTube" },
                { href: site.socials.facebook, icon: FacebookIcon, label: "Facebook" },
              ].map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:border-lime/50 hover:text-lime"
                >
                  <s.icon className="h-4.5 w-4.5" />
                </a>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
              Explore
            </div>
            <ul className="mt-4 space-y-2.5">
              {nav.map((n) => (
                <li key={n.href}>
                  <a
                    href={n.href}
                    className="text-sm text-white/60 transition-colors hover:text-lime"
                  >
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
              Visit us
            </div>
            <div className="mt-4 flex items-start gap-2 text-sm text-white/60">
              <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-lime" />
              <span>{site.address}</span>
            </div>
            <div className="mt-3 text-sm text-white/60">{site.hours}</div>
            <a
              href={`tel:${site.phone.replace(/\s/g, "")}`}
              className="mt-3 block text-sm text-white/60 hover:text-lime"
            >
              {site.phone}
            </a>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row">
          <span>
            © {new Date().getFullYear()} {site.name}. All rights reserved.
          </span>
          <span>
            Best Gym in Nashik · Personal Training · Medical Fitness · Weight
            Loss
          </span>
        </div>
      </div>
    </footer>
  );
}
