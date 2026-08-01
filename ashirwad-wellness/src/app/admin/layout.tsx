import Link from "next/link";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  MapPin,
  Ticket,
  Boxes,
  ScrollText,
  Users,
} from "lucide-react";

import { auth } from "@/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) redirect("/login?next=/admin");
  if (session.user.role !== "ADMIN") redirect("/");

  const links = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/products", label: "Products", icon: Package },
    { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
    { href: "/admin/inventory", label: "Inventory", icon: Boxes },
    { href: "/admin/pincodes", label: "Pincodes", icon: MapPin },
    { href: "/admin/coupons", label: "Coupons", icon: Ticket },
    { href: "/admin/staff", label: "Staff", icon: Users },
    { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl text-ink">Administration</h1>
      <p className="text-xs text-ink-500">
        {session.user.name} · {session.user.email}
      </p>

      <p className="mt-2 max-w-prose rounded-[var(--radius-control)] bg-paper-sunk p-2.5 text-[0.6875rem] leading-relaxed text-ink-500">
        Nothing in this section can verify a prescription, write to the Schedule
        H1 register, or alter the audit log. Dispensing decisions belong to a
        registered pharmacist.
      </p>

      <nav className="mt-4 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-ink-700 hover:bg-pine-50"
          >
            <link.icon aria-hidden="true" className="size-3.5" />
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">{children}</div>
    </div>
  );
}
