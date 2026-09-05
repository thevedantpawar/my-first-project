import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, FileText, History, BookLock } from "lucide-react";

import { auth } from "@/auth";
import { getQueueCounts } from "@/lib/pharmacist";
import { pharmacy } from "@/lib/pharmacy";

export default async function PharmacistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Middleware routes this too, but middleware is routing, not authorisation.
  // Every server action here calls requirePharmacist independently.
  if (!session?.user?.id) redirect("/login?next=/pharmacist");
  if (session.user.role !== "PHARMACIST" && session.user.role !== "ADMIN") {
    redirect("/");
  }

  const counts = await getQueueCounts();

  const links = [
    { href: "/pharmacist", label: "Prescriptions", icon: ClipboardList, count: counts.prescriptions },
    { href: "/pharmacist/orders", label: "Orders", icon: FileText, count: counts.orders },
    { href: "/pharmacist/register", label: "H1 register", icon: BookLock },
    { href: "/pharmacist/log", label: "My action log", icon: History },
  ];

  const regNoMissing = !session.user.pharmacistRegNo;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl text-ink">Pharmacist portal</h1>
          <p className="text-xs text-ink-500">
            {session.user.name} ·{" "}
            <span className="identifier">
              {session.user.pharmacistRegNo ?? "no registration number on file"}
            </span>{" "}
            · {pharmacy.pharmacistCouncil}
          </p>
        </div>
      </div>

      {regNoMissing && (
        <div className="rx-gate mt-4 rounded-r-[var(--radius-control)] p-3">
          <p className="text-sm text-rx-700">
            <strong className="font-semibold">
              Verification is blocked.
            </strong>{" "}
            Your pharmacist registration number is not on file. It is recorded on
            every Schedule H1 register entry, so an administrator must set it
            before you can verify prescriptions or approve orders.
          </p>
        </div>
      )}

      <nav className="mt-4 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-ink-700 hover:bg-pine-50"
          >
            <link.icon aria-hidden="true" className="size-3.5" />
            {link.label}
            {link.count !== undefined && link.count > 0 && (
              <span className="identifier rounded-full bg-rx-500 px-1.5 text-[0.6875rem] font-bold text-paper">
                {link.count}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="mt-6">{children}</div>
    </div>
  );
}
