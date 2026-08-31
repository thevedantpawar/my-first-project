import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "Book a 20-minute call",
  description:
    "Pick a time. Twenty minutes, one question answered: where is your clinic losing bookings right now?",
  alternates: { canonical: "/book" },
  openGraph: {
    title: "Book a 20-minute call — Microns",
    description:
      "No deck, no pitch. If there's nothing worth automating, we'll say so.",
    url: "/book",
  },
};

const agenda = [
  {
    t: "What you use now",
    d: "Booking software, phone, how enquiries reach you and who answers them.",
  },
  {
    t: "Where the money is going",
    d: "We look at missed calls, reply times, no-shows and review volume, and find the biggest of the four.",
  },
  {
    t: "What we would build first",
    d: "One system, not five, with a price and a timeline. If nothing here is worth building, we say that instead.",
  },
];

export default function BookPage() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-6 pb-24 pt-14 md:px-10 md:pb-32 md:pt-20 lg:px-16">
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <h1 className="max-w-[16ch] text-display-1">
            Twenty minutes. One question.
          </h1>
          <p className="mt-8 max-w-[42ch] text-lead text-slate">
            Where is your clinic losing bookings right now? No deck. No pitch.
            If there&rsquo;s nothing worth automating, we&rsquo;ll say so.
          </p>

          <dl className="mt-12 border-t border-mist">
            {agenda.map((a) => (
              <div key={a.t} className="border-b border-mist py-5">
                <dt className="text-[1.0625rem]">{a.t}</dt>
                <dd className="mt-1 max-w-[46ch] text-[0.9375rem] leading-relaxed text-slate">
                  {a.d}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:col-span-6 lg:col-start-7">
          {site.bookingUrl ? (
            <iframe
              src={site.bookingUrl}
              title="Booking calendar"
              className="h-[680px] w-full border border-mist bg-porcelain"
              loading="lazy"
            />
          ) : (
            /* No calendar configured yet. Show a real way to book rather than
               an empty frame. */
            <div className="border border-mist p-8 md:p-10">
              <h2 className="text-display-3">Book by email for now.</h2>
              <p className="mt-5 max-w-[44ch] text-slate">
                The calendar link isn&rsquo;t live yet. Send two or three times
                that suit you this week and you&rsquo;ll get a confirmation the
                same day.
              </p>
              <p className="mt-8">
                <a
                  href={`mailto:${site.founder.email}?subject=${encodeURIComponent(
                    "20-minute call",
                  )}`}
                  data-cta="book"
                  className="plausible-event-name=Book+call inline-flex min-h-[52px] items-center bg-micron px-7 text-[1.0625rem] leading-none text-porcelain transition-colors hover:bg-[#1636b4]"
                >
                  Email {site.founder.email}
                </a>
              </p>
              <p className="mt-8 text-meta text-slate">
                Prefer to send the details first?{" "}
                <Link
                  href="/audit"
                  className="underline decoration-mist underline-offset-[6px] hover:text-micron"
                >
                  Request a revenue leak audit
                </Link>{" "}
                and you&rsquo;ll get the same answer in writing.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
