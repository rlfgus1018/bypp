import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isSessionId, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sessionDir } from "@/lib/db/session";

// Gives every browser an anonymous session id (session mode only — see src/lib/db/session.ts). It must happen
// here: a page render cannot set cookies. The id is also put on the REQUEST, so the very first request already
// runs under its new session. Nothing is created on disk by this; databases appear on a session's first write.
export function proxy(request: NextRequest) {
  if (!sessionDir() || isSessionId(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const sessionId = randomBytes(32).toString("base64url"); // 256 bits
  request.cookies.set(SESSION_COOKIE, sessionId);
  const headers = new Headers(request.headers);
  headers.set("cookie", request.cookies.toString());

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax", // sent on the top-level redirect back from Google
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export const config = {
  // Everything except build assets and static files.
  matcher: ["/((?!_next/static|_next/image|assets/|favicon.ico).*)"],
};
