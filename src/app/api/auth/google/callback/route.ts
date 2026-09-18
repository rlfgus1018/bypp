import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";
import { completeConnection, STATE_COOKIE } from "@/lib/google/connection";
import { getGoogleRuntime } from "@/lib/google/runtime";
import { localRedirect } from "@/lib/http/local-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OAuth callback. The code is exchanged here, on the server, and the browser is then sent to a FIXED local
// path carrying only a result code — never the code, the state, a token, or a caller-supplied URL. The path is
// sent relative (see localRedirect): an absolute URL from request.url pointed at the container behind a proxy.
// Nothing is logged here: the query string of this request holds the (single-use) code and state.
export async function GET(request: Request) {
  const done = (result: string) => localRedirect(`/calendar?google=${encodeURIComponent(result)}`);

  const google = getGoogleRuntime();
  if (!google) return done("not_configured");

  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const cookieState = jar.get(STATE_COOKIE)?.value ?? null;
  jar.delete({ name: STATE_COOKIE, path: "/api/auth/google" }); // one use, whatever happens next

  try {
    const result = await completeConnection(
      getDb(),
      google.oauth,
      { code: params.get("code"), state: params.get("state"), error: params.get("error"), cookieState },
      { nowMs: Date.now(), tokenKey: google.tokenKey },
    );
    return done(result);
  } catch {
    // Deliberately not logging the error object: it may carry the token response.
    return done("exchange_failed");
  }
}
