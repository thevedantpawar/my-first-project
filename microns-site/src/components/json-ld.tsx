import { faqs } from "@/content/copy";
import { site } from "@/content/site";

/**
 * ProfessionalService for the studio, plus the FAQ that is actually rendered
 * on the page. Nothing here claims anything the page does not.
 */
export function HomeJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfessionalService",
        "@id": `${site.url}/#studio`,
        name: site.name,
        url: site.url,
        description: site.tagline,
        email: site.founder.email,
        founder: {
          "@type": "Person",
          name: `${site.founder.firstName} ${site.founder.lastName}`,
        },
        areaServed: [
          { "@type": "Country", name: "United States" },
          { "@type": "Country", name: "Canada" },
          { "@type": "Country", name: "United Kingdom" },
          { "@type": "Country", name: "Australia" },
        ],
        serviceType: "Marketing and front-desk automation for med spas",
        priceRange: `${site.pricing.rangeLow}–${site.pricing.rangeHigh}`,
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: "Systems",
          itemListElement: [
            "Speed-to-lead reply",
            "No-show prevention",
            "No-show recovery",
            "Review requests",
            "Front desk handoff",
          ].map((name) => ({
            "@type": "Offer",
            itemOffered: { "@type": "Service", name },
          })),
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${site.url}/#faq`,
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
