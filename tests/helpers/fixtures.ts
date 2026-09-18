import { readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "../fixtures/kakao");

export const fixtureBytes = (name: string) => new Uint8Array(readFileSync(path.join(DIR, name)));
export const fixtureText = (name: string) => readFileSync(path.join(DIR, name), "utf8");
