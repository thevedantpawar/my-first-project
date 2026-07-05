import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const url = "https://healthrx.fit";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: {
    default: `${site.name} — Best Gym in ${site.city} | ${site.tagline}`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  keywords: [
    "Best Gym in Nashik",
    "Personal Training Nashik",
    "Medical Fitness Nashik",
    "Weight Loss Nashik",
    "Gym in Nashik",
    "Fitness Club Nashik",
    "Transformation coaching Nashik",
    "Women's gym Nashik",
  ],
  authors: [{ name: site.name }],
  creator: site.name,
  alternates: { canonical: url },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url,
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  robots: { index: true, follow: true },
  category: "fitness",
};

export const viewport: Viewport = {
  themeColor: "#0B0B0B",
  width: "device-width",
  initialScale: 1,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "HealthAndBeautyBusiness",
  name: site.name,
  slogan: site.tagline,
  description: site.description,
  telephone: site.phone,
  email: site.email,
  address: {
    "@type": "PostalAddress",
    streetAddress: "College Road",
    addressLocality: "Nashik",
    addressRegion: "Maharashtra",
    postalCode: "422005",
    addressCountry: "IN",
  },
  areaServed: "Nashik",
  openingHours: "Mo-Su 05:00-23:00",
  priceRange: "₹₹",
  url,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
