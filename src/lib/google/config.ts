// Server-only configuration. None of these values may reach a component, a response body or a log.

type Env = Record<string, string | undefined>;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

/**
 * calendar.events.owned — the narrowest scope that events.insert AND events.get both accept for the user's
 *   own (primary) calendar. calendar.events would also cover calendars merely shared with the user, and
 *   `calendar` is full management: neither is needed.
 * openid + email — the verified `sub` is the only stable way to tell "the same account again" from
 *   "a different account"; the email is shown so the user can see which calendar receives the events.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
export const REQUESTED_SCOPES = ["openid", "email", CALENDAR_SCOPE];

/** "primary" is an alias that depends on the account, which is why every sync row also records the account. */
export const TARGET_CALENDAR_ID = "primary";

export function readGoogleConfig(env: Env = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  try {
    new URL(redirectUri);
  } catch {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

/** Optional AES-256-GCM key for tokens at rest: 32 bytes, base64. Kept apart from the DB and the client secret. */
export function readTokenKey(env: Env = process.env): Buffer | null {
  const raw = env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}
