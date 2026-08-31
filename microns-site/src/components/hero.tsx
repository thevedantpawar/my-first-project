import { BookButton, TextLink } from "./ui";
import { HeroInstrument } from "./hero-instrument";

export function Hero() {
  return (
    <section className="mx-auto w-full max-w-[1400px] px-6 pb-16 pt-10 md:px-10 md:pb-24 md:pt-16 lg:px-16 lg:pb-32 lg:pt-20">
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <h1
            className="seq text-display-1"
            style={{ ["--seq-delay" as string]: "0ms" }}
          >
            The front desk can&rsquo;t answer every call.
            <br className="hidden sm:block" /> The system can.
          </h1>

          <div
            className="seq-rule mt-9 h-px w-full max-w-[34rem] bg-mist"
            style={{ ["--seq-delay" as string]: "250ms" }}
            aria-hidden="true"
          />

          <p
            className="seq mt-9 max-w-[48ch] text-lead text-slate"
            style={{ ["--seq-delay" as string]: "300ms" }}
          >
            Microns builds the automation layer that catches the calls, leads
            and no-shows your med spa is currently losing — running quietly
            behind the software you already use.
          </p>

          <div
            className="seq mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-8"
            style={{ ["--seq-delay" as string]: "450ms" }}
          >
            <BookButton className="w-full sm:w-auto" />
            <TextLink href="/systems" className="text-[1.0625rem]">
              See what we build
            </TextLink>
          </div>
        </div>

        <div className="lg:col-span-4 lg:col-start-9">
          <HeroInstrument />
        </div>
      </div>
    </section>
  );
}
