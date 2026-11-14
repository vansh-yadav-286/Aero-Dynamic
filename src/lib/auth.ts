import { getServerSession } from "next-auth/next";
import { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { Role } from "@prisma/client";
import { db } from "./db";
import { cache } from "react";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

export const authOptions: AuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.users.findUnique({
          where: { email: credentials.email.trim().toLowerCase() },
        });

        if (!user?.password) {
          return null;
        }

        const passwordValid = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!passwordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      }
    })
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as any).id = token.sub;
        (session.user as any).role = (token.role as Role) || Role.OPERATIONS_DIRECTOR;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role || Role.OPERATIONS_DIRECTOR;
      }
      return token;
    }
  },
  events: {
    async signIn({ user }) {
      try {
        await db.auditLedger.create({
          data: {
            userId: user.id,
            action: "SIGN_IN",
            resourceId: user.id,
            ipAddress: "127.0.0.1",
          }
        });
      } catch (err) {
        console.error("Failed to log sign-in audit:", err);
      }
    }
  }
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
    return session ? (session as unknown as Session) : null;
  } catch (e) {
    console.warn("getSession error:", e);
    return null;
  }
});

export function getDashboardForRole(role: Role): string {
  switch (role) {
    case Role.GROUND_CREW_LEAD:
      return '/crew/dashboard';
    case Role.FLIGHT_DISPATCHER:
      return '/dispatcher/dashboard';
    case Role.OPERATIONS_DIRECTOR:
      return '/director/ledger';
    default:
      return '/';
  }
}

export async function requireRole(allowedRoles: Role[]): Promise<Session> {
  const session = await getSession();

  if (!session?.user) {
    redirect('/login');
  }

  // Deny by default: an empty allow-list authorizes no one.
  if (allowedRoles.length === 0 || !allowedRoles.includes(session.user.role)) {
    redirect('/unauthorized');
  }

  return session;
}
