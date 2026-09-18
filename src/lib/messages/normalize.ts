/**
 * Normalization used for fingerprinting only. It never changes the meaning of
 * the text: NFC, LF line endings, no trailing whitespace, no outer blank lines.
 */
export function normalizeText(text: string): string {
  const lines = text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+$/g, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function normalizeSender(sender: string): string {
  return sender.normalize("NFC").trim();
}
