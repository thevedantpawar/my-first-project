import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HealthRx Fitness Club",
    short_name: "HealthRx",
    description: "We Prescribe Health — Nashik's premium medical fitness club.",
    start_url: "/",
    display: "standalone",
    background_color: "#0F1A14",
    theme_color: "#0F1A14",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
