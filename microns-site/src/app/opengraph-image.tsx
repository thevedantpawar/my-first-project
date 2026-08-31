import { ImageResponse } from "next/og";

export const alt =
  "Microns — the front desk can't answer every call. The system can.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Real OG image, generated at build time from the site's own type and colour. */
export default async function OpengraphImage() {
  let serif: ArrayBuffer | null = null;
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap",
      { headers: { "User-Agent": "Mozilla/5.0" } },
    ).then((r) => r.text());
    const url = css.match(/src: url\((https:[^)]+\.ttf)\)/)?.[1];
    if (url) serif = await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    // Fall back to the default face rather than failing the build.
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#F3F4F2",
          color: "#14181C",
          padding: "72px 80px",
          fontFamily: serif ? "Instrument Serif" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 34 }}>Microns</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", width: 420, height: 2, backgroundColor: "#1B3FD1" }} />
          <div
            style={{
              display: "flex",
              fontSize: 76,
              lineHeight: 1.04,
              marginTop: 36,
              maxWidth: 900,
            }}
          >
            The front desk can&rsquo;t answer every call. The system can.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#5A6570" }}>
          Automation systems for med spas
        </div>
      </div>
    ),
    {
      ...size,
      fonts: serif
        ? [{ name: "Instrument Serif", data: serif, style: "normal", weight: 400 }]
        : undefined,
    },
  );
}
