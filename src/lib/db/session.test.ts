import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CALENDAR_SCOPE } from "@/lib/google/config";
import { beginConnection, completeConnection, getConnectionView } from "@/lib/google/connection";
import type { GoogleOAuthClient } from "@/lib/google/oauth-client";
import { createDb } from "./client";
import { importantKeywordsRepo } from "./repositories/important-keywords";
import { SCHEMA_VERSION } from "./schema";
import { closeSessionDbs, isSessionId, openSessionDb, sessionDbPath, sessionDir } from "./session";

const newId = () => randomBytes(32).toString("base64url");
const tempDir = () => mkdtempSync(join(tmpdir(), "bypp-sessions-"));
const open = (dir: string, id: string, create: boolean) => openSessionDb(dir, id, { create, open: createDb });

afterEach(() => closeSessionDbs());

describe("session ids and paths", () => {
  it("accepts exactly the 43-character base64url ids the proxy issues, and nothing that could leave the directory", () => {
    expect(isSessionId(newId())).toBe(true);
    for (const bad of [undefined, "", "abc", "../".repeat(14) + "x", `${newId()}x`, newId().slice(1), `${newId().slice(0, 42)}/`, `${newId().slice(0, 42)}.`]) {
      expect(isSessionId(bad)).toBe(false);
    }
    const dir = tempDir();
    const id = newId();
    expect(sessionDbPath(dir, id)).toBe(join(dir, id, "bypp.db"));
    expect(() => sessionDbPath(dir, "../../etc/passwd")).toThrow();
    expect(() => open(dir, "..", true)).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("is on only when BYPP_SESSION_DIR is set — NODE_ENV alone never enables it", () => {
    expect(sessionDir({ NODE_ENV: "production" })).toBeNull();
    expect(sessionDir({ BYPP_SESSION_DIR: "  " })).toBeNull();
    expect(sessionDir({ BYPP_SESSION_DIR: "/data/sessions" })).toMatch(/sessions$/);
  });
});

describe("one database per session", () => {
  it("is created lazily: reading creates nothing, the first write creates <dir>/<sid>/bypp.db with the usual schema", () => {
    const dir = tempDir();
    const id = newId();
    expect(open(dir, id, false)).toBeNull();
    expect(readdirSync(dir)).toEqual([]);

    const db = open(dir, id, true)!;
    expect(existsSync(join(dir, id, "bypp.db"))).toBe(true);
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    expect(open(dir, id, false)).toBe(db); // cached, and now visible to reads
  });

  it("keeps everything apart: data and the Google connection of session A are invisible to session B", async () => {
    const dir = tempDir();
    const [a, b] = [open(dir, newId(), true)!, open(dir, newId(), true)!];
    expect(a).not.toBe(b);

    importantKeywordsRepo(a).add("운영위원회");
    expect(importantKeywordsRepo(b).list()).toEqual([]);

    const oauth: GoogleOAuthClient = {
      buildAuthUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
      exchangeCode: async () => ({ accessToken: "FAKE-ACCESS", refreshToken: "FAKE-REFRESH", expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope: `openid email ${CALENDAR_SCOPE}`, idToken: "FAKE-ID" }),
      verifyIdentity: async () => ({ sub: "sub-a", email: "a@example.com" }),
      refresh: async () => ({ accessToken: "FAKE-ACCESS-2", expiresAt: new Date(Date.now() + 3600_000).toISOString(), refreshToken: null, scope: null }),
      revoke: async () => undefined,
    };
    const { state } = beginConnection(a, oauth, Date.now());
    // The same state replayed against ANOTHER session is refused: it was only ever recorded in A's database.
    expect(await completeConnection(b, oauth, { code: "code", state, error: null, cookieState: state }, { nowMs: Date.now(), tokenKey: null })).toBe("bad_state");
    expect(await completeConnection(a, oauth, { code: "code", state, error: null, cookieState: state }, { nowMs: Date.now(), tokenKey: null })).toBe("connected");

    expect(getConnectionView(a, true)).toMatchObject({ state: "connected", email: "a@example.com" });
    expect(getConnectionView(b, true)).toEqual({ state: "not-connected" });
    expect(b.prepare("SELECT COUNT(*) AS n FROM google_connections").get()).toEqual({ n: 0 });
  });
});
