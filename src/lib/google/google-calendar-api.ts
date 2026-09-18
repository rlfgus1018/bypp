// The only file allowed to import @googleapis/calendar (enforced by ESLint). Server-only.
import { auth, calendar, type calendar_v3 } from "@googleapis/calendar";
import { GoogleApiError, type GoogleApiErrorKind, type GoogleCalendarApi, type RemoteEvent } from "./calendar-api";
import type { GoogleEventBody } from "./event-mapper";

if (typeof window !== "undefined") {
  throw new Error("google-calendar-api must never be loaded in the browser");
}

const REQUEST_TIMEOUT_MS = 20_000;

/** Reduces an SDK/HTTP error to a kind. The original is dropped on purpose: its config holds the bearer token. */
function toApiError(error: unknown): GoogleApiError {
  const candidate = error as {
    response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } };
    code?: unknown;
    status?: unknown;
  } | null;
  const status = candidate?.response?.status ?? (typeof candidate?.status === "number" ? candidate.status : undefined);
  const reasons = candidate?.response?.data?.error?.errors?.map((entry) => entry.reason ?? "") ?? [];
  let kind: GoogleApiErrorKind = "unknown";
  if (status === 409) kind = "conflict";
  else if (status === 401) kind = "unauthorized";
  else if (status === 429 || (status === 403 && reasons.some((reason) => /rateLimit|quota/i.test(reason)))) kind = "rate-limited";
  else if (status === 403) kind = "forbidden-scope";
  else if (status === 400) kind = "bad-request";
  else if (status !== undefined && status >= 500) kind = "server";
  else if (status === undefined) {
    const code = typeof candidate?.code === "string" ? candidate.code : "";
    kind = /TIMEDOUT|ECONNABORTED|ABORT/i.test(code) ? "timeout" : "network";
  }
  return new GoogleApiError(kind);
}

const toRemote = (event: calendar_v3.Schema$Event): RemoteEvent => ({
  id: event.id ?? "",
  status: event.status ?? null,
  privateProperties: event.extendedProperties?.private ?? {},
});

export class RealGoogleCalendarApi implements GoogleCalendarApi {
  // An access token only: no refresh token, no client secret. The SDK cannot refresh by itself, so a 401
  // surfaces to the caller, which owns refreshing (and its retry limit).
  private client(accessToken: string) {
    const credentials = new auth.OAuth2();
    credentials.setCredentials({ access_token: accessToken });
    return calendar({ version: "v3", auth: credentials });
  }

  async insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody): Promise<RemoteEvent> {
    try {
      // retry: false — every retry decision is made by the orchestration, which must look before it re-sends.
      // sendUpdates "none": BYPP never adds attendees, and never emails anyone.
      const response = await this.client(accessToken).events.insert(
        { calendarId, sendUpdates: "none", requestBody: body },
        { timeout: REQUEST_TIMEOUT_MS, retry: false },
      );
      return toRemote(response.data);
    } catch (error) {
      throw toApiError(error);
    }
  }

  async getEvent(accessToken: string, calendarId: string, eventId: string): Promise<RemoteEvent | null> {
    try {
      const response = await this.client(accessToken).events.get({ calendarId, eventId }, { timeout: REQUEST_TIMEOUT_MS, retry: false });
      return toRemote(response.data);
    } catch (error) {
      const status = (error as { response?: { status?: number } } | null)?.response?.status;
      if (status === 404) return null;
      throw toApiError(error);
    }
  }
}
