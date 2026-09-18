import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { beginConnection, STATE_COOKIE, STATE_TTL_SECONDS } from "@/lib/google/connection";
import { getGoogleRuntime } from "@/lib/google/runtime";
import { localRedirect } from "@/lib/http/local-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts the OAuth Authorization Code flow. This only redirects: it creates no calendar event and stores no
// token. The one-time state is bound to this browser by an HttpOnly cookie and recorded (hashed) server-side.
export async function GET() {
  const google = getGoogleRuntime();
  if (!google) return localRedirect("/calendar?google=not_configured");

  const { url, state } = beginConnection(getDb(), google.oauth, Date.now());
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    secure: new URL(google.config.redirectUri).protocol === "https:",
    maxAge: STATE_TTL_SECONDS,
    path: "/api/auth/google",
  });
  return NextResponse.redirect(url);
}
