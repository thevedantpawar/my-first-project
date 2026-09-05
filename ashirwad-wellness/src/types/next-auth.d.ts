import type { Role } from "@/generated/prisma/enums";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      pharmacistRegNo: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    pharmacistRegNo?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    pharmacistRegNo: string | null;
  }
}
