import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { POST as importPost } from "@/app/api/imports/route";
import { POST as previewPost } from "@/app/api/imports/preview/route";
import { BACKUP_KEEP, backupDb } from "./backup";
import { createDb } from "./client";
import { SCHEMA_VERSION } from "./schema";

const tempDir = () => mkdtempSync(join(tmpdir(), "bypp-backup-"));

describe("database backups", () => {
  it("copies the whole database next to it, named by KST time and reason", () => {
    const dir = tempDir();
    const db = createDb(join(dir, "bypp.db"));
    db.prepare("INSERT INTO important_keywords (id, keyword, normalized, created_at) VALUES ('k', '총회', '총회', 't')").run();

    const file = backupDb(db, "Before Delete!", { now: new Date("2026-09-18T15:30:05Z") })!;
    expect(file).toBe(join(dir, "backups", "bypp-20260919-003005-before-delete.db"));
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare("SELECT keyword FROM important_keywords").get()).toEqual({ keyword: "총회" });
    expect(copy.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    copy.close();
    db.close();
  });

  it(`keeps the newest ${BACKUP_KEEP} and never collides within one second`, () => {
    const dir = tempDir();
    const db = createDb(join(dir, "bypp.db"));
    const now = new Date("2026-09-18T00:00:00Z");
    for (let i = 0; i < BACKUP_KEEP + 3; i++) backupDb(db, "manual", { now: new Date(now.getTime() + i * 1000) });
    backupDb(db, "manual", { now: new Date(now.getTime() + (BACKUP_KEEP + 2) * 1000) }); // same second as the last one
    const files = readdirSync(join(dir, "backups")).sort();
    expect(files).toHaveLength(BACKUP_KEEP);
    expect(files.some((name) => name.endsWith("-090012-manual-2.db"))).toBe(true);
    expect(files[0]).not.toContain("090000-"); // the oldest were pruned
    db.close();
  });

  it("does nothing for an in-memory database", () => {
    expect(backupDb(createDb(":memory:"), "manual")).toBeNull();
  });

  it("an existing database is backed up before a schema upgrade — and not on a normal open or a new file", () => {
    const dir = tempDir();
    const path = join(dir, "bypp.db");
    createDb(path).close(); // brand new: nothing to back up
    expect(() => readdirSync(join(dir, "backups"))).toThrow();

    const old = new Database(path);
    old.pragma(`user_version = ${SCHEMA_VERSION - 1}`);
    old.close();
    createDb(path).close();
    const [backup] = readdirSync(join(dir, "backups"));
    expect(backup).toMatch(new RegExp(`-before-v${SCHEMA_VERSION}\\.db$`));
    const copy = new Database(join(dir, "backups", backup), { readonly: true });
    expect(copy.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION - 1); // taken BEFORE the upgrade
    copy.close();

    createDb(path).close(); // already current: no new backup
    expect(readdirSync(join(dir, "backups"))).toHaveLength(1);
  });
});

describe("upload routes reject a malformed request with 400", () => {
  const garbage = () =>
    new Request("http://localhost/api/imports", { method: "POST", body: "not multipart", headers: { "content-type": "multipart/form-data; boundary=x" } });

  it.each([
    ["import", importPost],
    ["preview", previewPost],
  ])("%s", async (_name, post) => {
    const response = await post(garbage());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "요청 형식이 올바르지 않습니다." });
  });
});
