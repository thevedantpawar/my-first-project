import { NextResponse } from "next/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const get = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string).trim() : "";

  // Honeypot. Accept it silently so the bot does not learn anything.
  if (get("website2")) return NextResponse.json({ ok: true });

  const payload = {
    name: get("name"),
    clinic: get("clinic"),
    email: get("email"),
    site: get("site"),
    leak: get("leak"),
    notes: get("notes").slice(0, 2000),
    receivedAt: new Date().toISOString(),
    source: "microns.site/audit",
  };

  if (
    !payload.name ||
    !payload.clinic ||
    !payload.leak ||
    !emailPattern.test(payload.email)
  ) {
    return NextResponse.json(
      { error: "Some required details are missing." },
      { status: 422 },
    );
  }

  const webhook = process.env.AUDIT_WEBHOOK_URL;

  if (!webhook) {
    // No webhook configured yet. Log it so nothing is silently dropped in dev.
    console.info("[audit] submission received", payload);
    return NextResponse.json({ ok: true, delivered: false });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  } catch (error) {
    console.error("[audit] webhook delivery failed", error);
    return NextResponse.json(
      { error: "Could not deliver the request." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, delivered: true });
}
