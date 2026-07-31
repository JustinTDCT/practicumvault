import "server-only";

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { User, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  SessionData,
  SessionRole,
  SESSION_COOKIE_NAME,
  sessionOptions,
} from "@/lib/session-config";

export type { SessionData, SessionRole };
export { SESSION_COOKIE_NAME, sessionOptions };

export interface AuthenticatedSession extends SessionData {
  user: User;
}

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

  return {
    ...session,
    role: user.role as SessionRole,
    sessionVersion: user.sessionVersion,
    user,
  };
}

export async function saveUserSession(user: User): Promise<void> {
  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role as SessionRole;
  session.organizationId = user.organizationId;
  session.sessionVersion = user.sessionVersion;
  session.isLoggedIn = true;
  await session.save();
}
