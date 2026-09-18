import type { GoogleEventBody } from "./event-mapper";

// The Calendar API boundary, as an interface so tests inject a fake and never touch the network.
// The real implementation is google-calendar-api.ts — the only file that imports @googleapis/calendar.
// Deliberately tiny: BYPP creates an event and, when unsure, looks that same event up. Nothing else.

export type RemoteEvent = {
  id: string;
  /** "cancelled" = it existed and was deleted on Google's side */
  status: string | null;
  privateProperties: Record<string, string>;
};

export interface GoogleCalendarApi {
  insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody): Promise<RemoteEvent>;
  /** null when Google has no event with that id */
  getEvent(accessToken: string, calendarId: string, eventId: string): Promise<RemoteEvent | null>;
}

export type GoogleApiErrorKind =
  | "conflict" // 409: an event with this id already exists — NOT proof that it is ours
  | "unauthorized" // 401
  | "forbidden-scope" // 403 insufficient permission
  | "rate-limited" // 429, or 403 with a rate/quota reason
  | "server" // 5xx
  | "timeout" // sent, no answer: the outcome is unknown
  | "network" // could not reach Google
  | "bad-request" // 400: our payload was rejected
  | "unknown";

/** Carries a kind only. SDK error objects include request headers (the bearer token): never keep or log them. */
export class GoogleApiError extends Error {
  constructor(public readonly kind: GoogleApiErrorKind) {
    super(`google calendar error: ${kind}`);
    this.name = "GoogleApiError";
  }
}

/** Worth trying the same request again shortly. */
export const isTransient = (kind: GoogleApiErrorKind) => kind === "rate-limited" || kind === "server" || kind === "timeout" || kind === "network";
