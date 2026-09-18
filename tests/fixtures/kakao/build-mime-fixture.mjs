// Regenerates wrapped-mime.eml from basic.txt:  node tests/fixtures/kakao/build-mime-fixture.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const body = readFileSync(path.join(dir, "basic.txt"));
const b64 = body.toString("base64").replace(/(.{76})/g, "$1\r\n");
const name = `=?UTF-8?B?${Buffer.from("카카오톡 대화.txt").toString("base64")}?=`;

const eml = [
  "From: sender@example.com",
  "To: me@example.com",
  "Subject: export",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="BOUND"',
  "",
  "--BOUND",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Attached.",
  "--BOUND",
  `Content-Type: text/plain; charset=utf-8; name="${name}"`,
  `Content-Disposition: attachment; filename="${name}"`,
  "Content-Transfer-Encoding: base64",
  "",
  b64,
  "--BOUND--",
  "",
].join("\r\n");

writeFileSync(path.join(dir, "wrapped-mime.eml"), eml);
