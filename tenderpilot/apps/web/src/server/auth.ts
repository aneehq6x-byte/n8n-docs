import "server-only";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { getDb, verifyCredentials } from "@tenderpilot/db";
import { resetRateLimit } from "@tenderpilot/jobs";
import { LIMITS, clientIpFrom, withinLimits } from "./security";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

/**
 * Email + password auth with stateless JWT sessions. NEXTAUTH_SECRET is read by
 * next-auth from the (secrets-hydrated) environment — never hard-coded.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/ar/sign-in" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, req) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.trim().toLowerCase();
        const forwarded: unknown = req.headers?.["x-forwarded-for"];
        const ip = clientIpFrom(forwarded);
        const allowed = await withinLimits(
          { key: `login:email:${email}`, ...LIMITS.loginPerEmail },
          { key: `login:ip:${ip}`, ...LIMITS.loginPerIp },
        );
        // Surfaces to the client as `error: "RATE_LIMITED"`.
        if (!allowed) throw new Error("RATE_LIMITED");
        const user = await verifyCredentials(getDb(), email, parsed.data.password);
        if (!user) return null;
        await resetRateLimit(`login:email:${email}`);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) {
        session.user = { id: token.uid, name: session.user.name ?? "", email: session.user.email ?? "" };
      }
      return session;
    },
  },
};

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id) return null;
  return { id: user.id, name: user.name, email: user.email };
}
