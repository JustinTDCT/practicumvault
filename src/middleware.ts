import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/session-config";

const publicPaths = ["/setup", "/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, sessionOptions);

  const isPublic =
    publicPaths.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/api/setup") ||
    pathname.startsWith("/api/auth/login");

  if (!session.isLoggedIn && !isPublic && pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.isLoggedIn && !isPublic && !pathname.startsWith("/setup")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session.isLoggedIn && pathname === "/login") {
    return NextResponse.redirect(
      new URL(session.role === "ADMIN" ? "/admin" : "/candidate", request.url),
    );
  }

  if (pathname.startsWith("/admin") && session.isLoggedIn && session.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/candidate", request.url));
  }

  if (pathname.startsWith("/candidate") && session.isLoggedIn && session.role !== "CANDIDATE") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
