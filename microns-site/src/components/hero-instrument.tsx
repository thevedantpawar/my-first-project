/**
 * The signature element. One orchestrated moment, then stillness.
 *
 * A micron scale down which a single recovered enquiry resolves: the call that
 * was missed, the reply that went out 38 seconds later, the consult that got
 * booked the next morning. Pure CSS so it runs on load with no layout shift,
 * and it is fully disabled by prefers-reduced-motion.
 *
 * It is captioned as an illustration. It is not a client record and it is not
 * a statistic.
 */

const events = [
  {
    time: "21:47",
    title: "Call comes in. Nobody there.",
    detail: "Clinic closed at 18:00. No voicemail left.",
    delay: 900,
  },
  {
    time: "21:47:38",
    title: "Reply goes out.",
    detail:
      "“Sorry we missed you — I can hold a consult slot on Thursday if that helps?”",
    delay: 1400,
    accent: true,
  },
  {
    time: "09:12",
    title: "Consult booked.",
    detail: "In the calendar before the clinic opens.",
    delay: 1900,
  },
];

export function HeroInstrument() {
  return (
    <figure className="m-0">
      <div className="relative pl-7">
        {/* the scale */}
        <div
          className="seq-scale absolute left-0 top-1 bottom-8 w-4"
          style={{ ["--seq-delay" as string]: "600ms" }}
          aria-hidden="true"
        >
          <div className="absolute left-0 top-0 h-full w-px bg-ink" />
          <div
            className="absolute left-0 top-0 h-full w-3"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, var(--color-mist) 0 1px, transparent 1px 9px)",
            }}
          />
        </div>

        <ol className="m-0 list-none space-y-9 p-0">
          {events.map((e) => (
            <li
              key={e.time}
              className="seq relative"
              style={{ ["--seq-delay" as string]: `${e.delay}ms` }}
            >
              <span
                className={`absolute -left-7 top-[0.55rem] h-px w-4 ${
                  e.accent ? "bg-micron" : "bg-ink"
                }`}
                aria-hidden="true"
              />
              <p
                className={`tnum text-meta ${
                  e.accent ? "text-micron" : "text-slate"
                }`}
              >
                {e.time}
              </p>
              <p className="mt-1.5 text-[1.0625rem] leading-snug">{e.title}</p>
              <p className="mt-1 max-w-[38ch] text-[0.9375rem] leading-normal text-slate">
                {e.detail}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <figcaption
        className="seq mt-7 max-w-[38ch] pl-7 text-meta text-slate"
        style={{ ["--seq-delay" as string]: "2300ms" }}
      >
        An illustration of a speed-to-lead reply, not a client record. The
        60-second target is what the system is built to hit.
      </figcaption>
    </figure>
  );
}
