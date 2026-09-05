import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo";

/**
 * Account, cart, checkout, the pharmacist portal and admin are all disallowed.
 * They are already unreachable without a session, but a crawler wasting its
 * budget on redirect chains helps nobody — and the existence of the pharmacist
 * portal is not something worth advertising.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/account",
          "/admin",
          "/api/",
          "/cart",
          "/checkout",
          "/login",
          "/order/",
          "/pharmacist",
          "/search",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
