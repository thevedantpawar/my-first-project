import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ProfileForm } from "@/components/account-forms";

export const metadata: Metadata = { title: "Profile", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true, email: true, phone: true, phoneVerified: true, createdAt: true },
  });

  return (
    <div className="max-w-2xl space-y-4">
      <ProfileForm initial={{ name: user.name, email: user.email, phone: user.phone }} />

      <p className="text-xs text-ink-500">
        Customer since{" "}
        <span className="identifier">{user.createdAt.toLocaleDateString("en-IN")}</span>
        {user.phone && !user.phoneVerified && (
          <> · your mobile number is not verified yet</>
        )}
      </p>
    </div>
  );
}
