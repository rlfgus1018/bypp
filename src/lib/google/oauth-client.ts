// The OAuth boundary, as an interface so tests inject a fake and never touch the network.
// The real implementation is google-oauth-client.ts — the only file that imports google-auth-library.

export type TokenSet = {
  accessToken: string;
  /** null when Google did not send one (it only does on a fresh consent) */
  refreshToken: string | null;
  /** ISO instant */
  expiresAt: string;
  /** space-delimited scopes actually granted — the user may untick some on the consent screen */
  scope: string;
  idToken: string | null;
};

export type RefreshedToken = { accessToken: string; expiresAt: string; refreshToken: string | null; scope: string | null };

export type GoogleIdentity = { sub: string; email: string | null };

export interface GoogleOAuthClient {
  buildAuthUrl(input: { state: string; forceConsent: boolean; loginHint: string | null }): string;
  exchangeCode(code: string): Promise<TokenSet>;
  /** Verifies the ID token (signature, audience, expiry) and returns the account's stable subject. */
  verifyIdentity(idToken: string): Promise<GoogleIdentity>;
  refresh(refreshToken: string): Promise<RefreshedToken>;
}

/**
 * invalid_grant: the grant is gone (revoked, expired, wrong account) → reconnect.
 * network: could not reach Google — says nothing about the grant.
 */
export type GoogleAuthErrorCode = "invalid_grant" | "invalid_client" | "network" | "unknown";

/** Carries a code only. The SDK's own error objects hold request headers and token responses: never keep them. */
export class GoogleAuthError extends Error {
  constructor(public readonly code: GoogleAuthErrorCode) {
    super(`google auth error: ${code}`);
    this.name = "GoogleAuthError";
  }
}
