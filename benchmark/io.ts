import fs from "fs";
import path from "path";
import { OUT_DIR } from "./config.js";

export const outPath = (...parts: string[]) => path.join(OUT_DIR, ...parts);

export function writeJson(file: string, data: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
}

export function readJson<T>(file: string): T {
    if (!fs.existsSync(file)) throw new Error(`${path.relative(process.cwd(), file)} is missing, run the earlier stages first`);
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export function writeText(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

export interface PairEnd {
    node: string;
    lat: number;
    lng: number;
}

export interface Pair {
    id: number;
    from: PairEnd;
    to: PairEnd;
    // straight line
    meters: number;
}
