import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://healthrx.fit";
  const now = new Date();
  const anchors = [
    "",
    "#services",
    "#philosophy",
    "#trainers",
    "#plans",
    "#results",
    "#calculators",
    "#faq",
    "#blog",
    "#contact",
  ];
  return anchors.map((a) => ({
    url: `${base}/${a}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: a === "" ? 1 : 0.7,
  }));
}
