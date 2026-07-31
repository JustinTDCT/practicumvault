/**
 * Edge-safe session configuration.
 * Must not import Prisma, database clients, or Node-only application services.
 */

export type SessionRole = "ADMIN" | "CANDIDATE";

export interface SessionData {
  userId: string;
  email: string;
  role: SessionRole;
  organizationId: string;
  sessionVersion: number;
  isLoggedIn: boolean;
}

export const SESSION_COOKIE_NAME = "practicum_vault_session";

export const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: SESSION_COOKIE_NAME,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7,
  },
};
