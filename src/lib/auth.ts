import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { UserRole } from "@prisma/client";

export interface SessionData {
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string;
  isLoggedIn: boolean;
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

export async function requireAuth(roles?: UserRole[]) {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    return null;
  }
  if (roles && !roles.includes(session.role)) {
    return null;
  }
  return session;
}
