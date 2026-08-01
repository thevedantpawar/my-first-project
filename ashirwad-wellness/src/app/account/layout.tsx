import Link from "next/link";
import { redirect } from "next/navigation";
import { User, Package, FileText, MapPin, Users, FolderLock } from "lucide-react";

import { auth } from "@/auth";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/account");

  const links = [
    { href: "/account", label: "Profile", icon: User },
    { href: "/account/orders", label: "Orders", icon: Package },
    { href: "/account/prescriptions", label: "Prescriptions", icon: FileText },
    { href: "/account/addresses", label: "Addresses", icon: MapPin },
    { href: "/account/family", label: "Family", icon: Users },
    { href: "/account/records", label: "Health records", icon: FolderLock },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl text-ink">Your account</h1>
      <p className="text-xs text-ink-500">{session.user.email}</p>

      <nav className="mt-4 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-ink-700 hover:bg-pine-50"
          >
            <l.icon aria-hidden="true" className="size-3.5" />
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">{children}</div>
    </div>
  );
}
