import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Manrope,
  IBM_Plex_Mono,
  Noto_Sans_Devanagari,
} from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

// Hindi product names render in the catalogue alongside the English name.
const devanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Ashirwad Wellness — Online Pharmacy, Nashik",
    template: "%s | Ashirwad Wellness",
  },
  description:
    "Licensed online pharmacy serving Nashik. Prescription medicines are verified by a registered pharmacist before dispensing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The font variables go on <html>, not <body>. The @theme tokens in
  // globals.css declare --font-display / --font-sans on :root, and a var()
  // reference inside a custom property is substituted using the element where
  // that property is declared. Declaring the font variables on <body> would
  // leave them undefined at :root, so every font token would silently resolve
  // to its fallback — which is exactly what happened before this comment.
  return (
    <html
      lang="en-IN"
      className={`${bricolage.variable} ${manrope.variable} ${plexMono.variable} ${devanagari.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
