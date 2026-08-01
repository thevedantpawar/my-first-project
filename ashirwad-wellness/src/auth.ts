import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { authConfig } from "@/auth.config";
import { audit } from "@/lib/audit";
import { Role } from "@/generated/prisma/enums";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            passwordHash: true,
            isActive: true,
            pharmacistRegNo: true,
          },
        });

        // Compare against a dummy hash when the user is absent so that a
        // missing account and a wrong password take the same time. Account
        // enumeration by timing is cheap to prevent and awkward to retrofit.
        const hash =
          user?.passwordHash ??
          "$2a$12$............................................................";
        const ok = await bcrypt.compare(password, hash);

        if (!user || !user.passwordHash || !ok || !user.isActive) {
          return null;
        }

        await audit({
          actorId: user.id,
          actorRole: user.role,
          action: "USER_LOGIN",
          entityType: "User",
          entityId: user.id,
          metadata: { provider: "credentials" },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          pharmacistRegNo: user.pharmacistRegNo,
        };
      },
    }),
  ],
});

/* ---------------------------------------------------------------------------
 * Server-side authorisation helpers.
 *
 * The JWT carries a role so middleware can route cheaply, but middleware is
 * routing, not authorisation. Every privileged server action re-reads the role
 * from the database through these helpers, so a revoked pharmacist cannot keep
 * dispensing on a still-valid token.
 * ------------------------------------------------------------------------- */

export class AuthorizationError extends Error {
  constructor(message = "Not authorised") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthorizationError("You must be signed in.");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      pharmacistRegNo: true,
    },
  });

  if (!user || !user.isActive) {
    throw new AuthorizationError("This account is no longer active.");
  }

  return user;
}

export async function requireRole(...allowed: Role[]) {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    throw new AuthorizationError(
      `This action requires the ${allowed.join(" or ")} role.`,
    );
  }
  return user;
}

/**
 * A pharmacist verifying a prescription must have a registration number on
 * file — it is stamped onto the Schedule H1 register and must be a real,
 * recorded value rather than an empty string.
 */
export async function requirePharmacist() {
  const user = await requireRole(Role.PHARMACIST, Role.ADMIN);

  if (!user.pharmacistRegNo) {
    throw new AuthorizationError(
      "Your pharmacist registration number is not on file. It is recorded on " +
        "every Schedule H1 register entry, so verification is blocked until an " +
        "administrator sets it.",
    );
  }

  return { ...user, pharmacistRegNo: user.pharmacistRegNo };
}

export async function requireAdmin() {
  return requireRole(Role.ADMIN);
}
