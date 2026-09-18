// Dry run: decode + parse only. No DB, no LLM, no network.
import { readFile } from "node:fs/promises";
import { decodeExportFile } from "../src/lib/kakao-export/decoder";
import { parseKakaoExport } from "../src/lib/kakao-export/parser";
import { computeFingerprints } from "../src/lib/messages/fingerprint";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run inspect:export -- "<path to export>"');
    process.exit(1);
  }
  const decoded = await decodeExportFile(new Uint8Array(await readFile(file)));
  const { roomName, messages, stats } = parseKakaoExport(decoded.text);
  const kinds: Record<string, number> = {};
  for (const m of messages) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
  const fingerprints = computeFingerprints(messages);

  console.log("container        :", decoded.container);
  console.log("room             :", roomName);
  console.log("messages         :", messages.length, kinds);
  console.log("system lines     :", stats.systemLines);
  console.log("date separators  :", stats.dateSeparators);
  console.log("deleted markers  :", stats.deletedPlaceholders);
  console.log("header lines     :", stats.headerLines);
  console.log("fp collisions    :", fingerprints.length - new Set(fingerprints).size);
  console.log("multiline msgs   :", messages.filter((m) => m.text.includes("\n")).length);
  console.log("senders          :", new Set(messages.map((m) => m.sender)).size);
  if (messages.length > 0) {
    const first = messages[0];
    const last = messages[messages.length - 1];
    console.log("first            :", first.sentAt, "|", first.text.split("\n")[0].slice(0, 50));
    console.log("last             :", last.sentAt, "|", last.text.split("\n")[0].slice(0, 50));
  }
  console.log("suspicious continuations:", stats.suspiciousContinuations.length);
  for (const s of stats.suspiciousContinuations.slice(0, 10)) console.log(`  L${s.lineNo}: ${s.line}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
