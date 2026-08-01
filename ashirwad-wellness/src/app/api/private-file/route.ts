import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getStorage, verifyObjectUrl } from "@/lib/storage";

/**
 * Serves privately-stored objects behind a signed URL.
 *
 * The signature proves the URL was minted by us and has not expired. It is
 * deliberately NOT the only check: this route also confirms the caller is
 * signed in and is either the owner of the record or a pharmacist/admin.
 *
 * A signed URL pasted into a group chat is therefore useless to anyone else,
 * which matters more here than it would for a product photograph.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const verified = verifyObjectUrl(
    searchParams.get("key"),
    searchParams.get("exp"),
    searchParams.get("sig"),
  );

  if (!verified.ok) {
    return new NextResponse(
      verified.reason === "expired"
        ? "This link has expired. Reopen the prescription to get a fresh one."
        : "Not found",
      { status: verified.reason === "expired" ? 410 : 404 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const role = session.user.role;
  const privileged = role === "PHARMACIST" || role === "ADMIN";

  // Re-establish entitlement from the key itself, independent of the signature.
  const [prescription, healthRecord] = await Promise.all([
    db.prescription.findFirst({
      where: { imageKey: verified.key },
      select: { userId: true },
    }),
    db.healthRecord.findFirst({
      where: { fileKey: verified.key },
      select: { userId: true },
    }),
  ]);

  const record = prescription ?? healthRecord;
  if (!record) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Health records are never a pharmacist's business; only prescriptions are.
  const allowed =
    record.userId === session.user.id || (privileged && Boolean(prescription));

  if (!allowed) {
    return new NextResponse("Not found", { status: 404 });
  }

  const object = await getStorage().get(verified.key);
  if (!object) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      "Content-Type": object.contentType,
      // Never cached by a shared cache, and not written to disk by the browser.
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
