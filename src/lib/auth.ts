import { getServerSession } from "next-auth/next";
import { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { db } from "./db";
import { cache } from "react";
import { hashPassword, verifyPassword } from "./password";

export const authOptions: AuthOptions = {
  // Set NEXTAUTH_SECRET in every environment. Never use a public fallback.
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;

        if (!email || !password) return null;

        try {
          const user = await db.users.findUnique({ where: { email } });
          if (!user?.password) return null;

          const result = await verifyPassword(password, user.password);
          if (!result.valid) return null;

          if (result.needsRehash) {
            try {
              await db.users.update({
                where: { id: user.id },
                data: { password: await hashPassword(password) },
              });
            } catch (error) {
              // Do not lock out a valid legacy account if the hash upgrade
              // fails temporarily. The legacy hash is checked again next time.
              console.error("Password hash upgrade failed:", error);
            }
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } catch (error) {
          // Fail closed when the database is unavailable.
          console.error("Credential authentication failed:", error);
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        const sessionUser = session.user as typeof session.user & {
          id?: string;
          role?: Role;
        };
        sessionUser.id = token.sub;
        if (typeof token.role === "string" && Object.values(Role).includes(token.role as Role)) {
          sessionUser.role = token.role as Role;
        }
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        const signedInUser = user as typeof user & { role?: Role };
        if (signedInUser.role && Object.values(Role).includes(signedInUser.role)) {
          token.role = signedInUser.role;
        }
      }
      return token;
    },
  },
  events: {
    async signIn({ user }) {
      try {
        await db.auditLedger.create({
          data: {
            userId: user.id,
            action: "SIGN_IN",
            resourceId: user.id,
          },
        });
      } catch (error) {
        console.error("Failed to log sign-in audit:", error);
      }
    },
  },
};

export type Session = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role: Role;
  };
};

export const getSession = cache(async (): Promise<Session | null> => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return null;

    const sessionUser = session.user as typeof session.user & {
      id?: string;
      role?: Role;
    };

    if (
      !sessionUser.id ||
      !sessionUser.role ||
      !Object.values(Role).includes(sessionUser.role)
    ) {
      return null;
    }

    return session as unknown as Session;
  } catch (error) {
    console.error("getSession failed:", error);
    return null;
  }
});

export function getDashboardForRole(role: Role): string {
  switch (role) {
    case Role.GROUND_CREW_LEAD:
      return "/crew/dashboard";
    case Role.FLIGHT_DISPATCHER:
      return "/dispatcher/dashboard";
    case Role.OPERATIONS_DIRECTOR:
      return "/director/ledger";
    default:
      return "/";
  }
}

export async function requireRole(allowedRoles: Role[]): Promise<Session> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (!allowedRoles.includes(session.user.role)) {
    redirect("/unauthorized");
  }

  return session;
}
