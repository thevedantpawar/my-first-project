import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe half of the auth config.
 *
 * Middleware runs on the edge runtime, where Prisma and bcrypt cannot. This
 * file holds everything the middleware needs (providers without DB access,
 * callbacks, page routes); `auth.ts` adds the adapter and the credentials
 * provider on the Node runtime.
 */
export const authConfig = {
  /**
   * Auth.js refuses to trust the incoming Host header unless it detects a
   * known hosting provider. This deployment is self-hosted behind a reverse
   * proxy, so without this every request fails with UntrustedHost and sign-in
   * is impossible — including on localhost.
   *
   * This is safe only because the proxy in front of the app sets Host itself.
   * If that ever stops being true, set AUTH_URL to the canonical origin
   * instead, which pins it rather than trusting the request.
   */
  trustHost: true,

  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    // Credentials sign-in requires JWT sessions; the Prisma adapter still
    // persists users, accounts and links.
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  callbacks: {
    /**
     * Role and id are carried on the token so middleware can authorise without
     * a database round trip on every request.
     *
     * `trigger === "update"` re-reads from the token only; a role change takes
     * effect on next sign-in. That is deliberate — a pharmacist whose role is
     * revoked should not keep dispensing rights for the life of their session,
     * so role revocation also deactivates the user, which the server-side
     * checks re-verify against the database at every privileged action.
     */
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.pharmacistRegNo = user.pharmacistRegNo ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as typeof session.user.role;
        session.user.pharmacistRegNo = (token.pharmacistRegNo as string | null) ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
