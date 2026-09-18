// The only file allowed to import google-auth-library (enforced by ESLint). Server-only.
import { OAuth2Client } from "google-auth-library";
import { REQUESTED_SCOPES, type GoogleConfig } from "./config";
import { GoogleAuthError, type GoogleAuthErrorCode, type GoogleIdentity, type GoogleOAuthClient, type RefreshedToken, type TokenSet } from "./oauth-client";

if (typeof window !== "undefined") {
  throw new Error("google-oauth-client must never be loaded in the browser");
}

// Used when Google omits expiry (it normally sends ~3600 s): short, so the token is simply refreshed early.
const FALLBACK_LIFETIME_MS = 5 * 60_000;

/** Reduces an SDK/HTTP error to a code. The original is dropped on purpose: it can contain tokens and headers. */
function toAuthError(error: unknown): GoogleAuthError {
  const candidate = error as { response?: { status?: number; data?: { error?: unknown } }; code?: unknown; message?: unknown } | null;
  const oauthError = typeof candidate?.response?.data?.error === "string" ? candidate.response.data.error : null;
  let code: GoogleAuthErrorCode = "unknown";
  if (oauthError === "invalid_grant" || (typeof candidate?.message === "string" && candidate.message.includes("invalid_grant"))) code = "invalid_grant";
  else if (oauthError === "invalid_client" || oauthError === "unauthorized_client") code = "invalid_client";
  else if (!candidate?.response && typeof candidate?.code === "string") code = "network"; // ENOTFOUND, ECONNRESET, ETIMEDOUT …
  return new GoogleAuthError(code);
}

const expiry = (expiryDate: number | null | undefined, nowMs: number) => new Date(expiryDate ?? nowMs + FALLBACK_LIFETIME_MS).toISOString();

export class RealGoogleOAuthClient implements GoogleOAuthClient {
  constructor(private readonly config: GoogleConfig) {}

  private client(): OAuth2Client {
    return new OAuth2Client({ clientId: this.config.clientId, clientSecret: this.config.clientSecret, redirectUri: this.config.redirectUri });
  }

  buildAuthUrl({ state, forceConsent, loginHint }: { state: string; forceConsent: boolean; loginHint: string | null }): string {
    return this.client().generateAuthUrl({
      response_type: "code",
      access_type: "offline", // a refresh token, so the connection survives a restart
      scope: REQUESTED_SCOPES,
      state,
      include_granted_scopes: false,
      // Google only returns a refresh token on a fresh consent.
      ...(forceConsent ? { prompt: "consent" } : {}),
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
  }

  async exchangeCode(code: string): Promise<TokenSet> {
    try {
      const { tokens } = await this.client().getToken(code);
      if (!tokens.access_token) throw new GoogleAuthError("unknown");
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: expiry(tokens.expiry_date, Date.now()),
        scope: tokens.scope ?? "",
        idToken: tokens.id_token ?? null,
      };
    } catch (error) {
      throw error instanceof GoogleAuthError ? error : toAuthError(error);
    }
  }

  async verifyIdentity(idToken: string): Promise<GoogleIdentity> {
    try {
      const ticket = await this.client().verifyIdToken({ idToken, audience: this.config.clientId });
      const payload = ticket.getPayload();
      if (!payload?.sub) throw new GoogleAuthError("unknown");
      return { sub: payload.sub, email: payload.email_verified === false ? null : (payload.email ?? null) };
    } catch (error) {
      throw error instanceof GoogleAuthError ? error : toAuthError(error);
    }
  }

  async revoke(token: string): Promise<void> {
    try {
      await this.client().revokeToken(token);
    } catch (error) {
      // 400 invalid_token: Google no longer knows this token — the grant is already gone, which is the goal.
      if ((error as { response?: { status?: number } } | null)?.response?.status === 400) return;
      throw toAuthError(error);
    }
  }

  async refresh(refreshToken: string): Promise<RefreshedToken> {
    try {
      const client = this.client();
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();
      if (!credentials.access_token) throw new GoogleAuthError("unknown");
      return {
        accessToken: credentials.access_token,
        expiresAt: expiry(credentials.expiry_date, Date.now()),
        // Present only when Google rotated it; the SDK echoes the old one back otherwise.
        refreshToken: credentials.refresh_token && credentials.refresh_token !== refreshToken ? credentials.refresh_token : null,
        scope: credentials.scope ?? null,
      };
    } catch (error) {
      throw error instanceof GoogleAuthError ? error : toAuthError(error);
    }
  }
}
