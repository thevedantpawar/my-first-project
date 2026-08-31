import { BookButton, TextLink } from "./ui";

/** Section 5.9. Every page ends here. */
export function CtaClose() {
  return (
    <section className="border-t border-mist">
      <div className="mx-auto w-full max-w-[1400px] px-6 py-24 md:px-10 md:py-32 lg:px-16 lg:py-40">
        <h2 className="max-w-[20ch] text-display-2">
          20 minutes, one question answered: where is your clinic losing
          bookings right now?
        </h2>
        <p className="mt-8 max-w-[46ch] text-lead text-slate">
          No deck. No pitch. If there&rsquo;s nothing worth automating,
          we&rsquo;ll say so.
        </p>
        <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-8">
          <BookButton className="w-full sm:w-auto" />
          <TextLink href="/audit" className="text-[1.0625rem]">
            Or request a revenue leak audit
          </TextLink>
        </div>
      </div>
    </section>
  );
}
