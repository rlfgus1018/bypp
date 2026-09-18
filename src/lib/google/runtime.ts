import type { GoogleCalendarApi } from "./calendar-api";
import { readGoogleConfig, readTokenKey, type GoogleConfig } from "./config";
import { RealGoogleCalendarApi } from "./google-calendar-api";
import { RealGoogleOAuthClient } from "./google-oauth-client";
import type { GoogleOAuthClient } from "./oauth-client";

// The real clients, built from the server's environment. Constructing them performs no I/O: nothing talks
// to Google at import, build or render time — only inside the OAuth routes and the explicit "create" action.

export type GoogleRuntime = { config: GoogleConfig; oauth: GoogleOAuthClient; api: GoogleCalendarApi; tokenKey: Buffer | null };

export function getGoogleRuntime(env: Record<string, string | undefined> = process.env): GoogleRuntime | null {
  const config = readGoogleConfig(env);
  if (!config) return null;
  return { config, oauth: new RealGoogleOAuthClient(config), api: new RealGoogleCalendarApi(), tokenKey: readTokenKey(env) };
}

export const isGoogleConfigured = (env: Record<string, string | undefined> = process.env) => readGoogleConfig(env) !== null;
