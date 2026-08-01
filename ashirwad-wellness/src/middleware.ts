import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

/**
 * Role-based routing.
 *
 * This is routing, not authorisation. It keeps signed-out users off account
 * pages and customers out of the pharmacist portal, which is a usability job.
 * The actual enforcement lives in `requireRole` / `requirePharmacist`, called
 * inside every privileged server action, and re-reads from the database.
 *
 * Assume this file can be bypassed. Nothing security-relevant may depend on
 * it alone.
 */
const { auth } = NextAuth(authConfig);

/** Prefix -> roles permitted to reach it. */
const PROTECTED: ReadonlyArray<{ prefix: string; roles: readonly string[] }> = [
  { prefix: "/pharmacist", roles: ["PHARMACIST", "ADMIN"] },
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/account", roles: ["CUSTOMER", "PHARMACIST", "ADMIN"] },
  { prefix: "/checkout", roles: ["CUSTOMER", "PHARMACIST", "ADMIN"] },
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const rule = PROTECTED.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  if (!rule) return NextResponse.next();

  const user = req.auth?.user;

  if (!user) {
    const login = new URL("/login", req.nextUrl.origin);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (!rule.roles.includes(user.role)) {
    // 404 rather than 403: the existence of the pharmacist portal is not
    // something a customer account needs confirmed.
    return NextResponse.rewrite(new URL("/not-found", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Everything except static assets, image optimisation, and the auth
    // endpoints themselves.
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
