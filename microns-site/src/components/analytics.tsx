import Script from "next/script";
import { site } from "@/content/site";

/**
 * Plausible, loaded only when a domain is configured. Both CTAs carry a
 * distinct class so the two conversion paths can be told apart:
 *   plausible-event-name=Book+call
 *   plausible-event-name=Audit+request
 */
export function Analytics() {
  if (!site.plausibleDomain) return null;

  return (
    <Script
      defer
      data-domain={site.plausibleDomain}
      src="https://plausible.io/js/script.tagged-events.js"
      strategy="afterInteractive"
    />
  );
}
