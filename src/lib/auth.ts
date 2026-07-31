import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { User, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface SessionData {
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string;
  sessionVersion: number;
  isLoggedIn: boolean;
}

export interface AuthenticatedSession extends SessionData {
  user: User;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "practicum_vault_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function requireAuth(roles?: UserRole[]): Promise<AuthenticatedSession | null> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.enabled) {
    return null;
  }
  if (user.organizationId !== session.organizationId) {
    return null;
  }
  if (user.role !== session.role) {
    return null;
  }
  if ((session.sessionVersion ?? 0) !== user.sessionVersion) {
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    return null;
  }

  return { ...session, sessionVersion: user.sessionVersion, user };
}

export async function saveUserSession(user: User): Promise<void> {
  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  session.organizationId = user.organizationId;
  session.sessionVersion = user.sessionVersion;
  session.isLoggedIn = true;
  await session.save();
}
