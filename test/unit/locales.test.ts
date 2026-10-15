import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { STRINGS } from "../../public/js/strings.js";

const ROOT = path.join(import.meta.dirname, "..", "..");
const LANGUAGES = ["en", "it", "de"];

function keysOf(value: unknown, prefix = ""): string[] {
    if (typeof value !== "object" || value === null) return [prefix];
    return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key));
}

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(full);
        return entry.name.endsWith(".ts") ? [full] : [];
    });
}

const raw = Object.fromEntries(LANGUAGES.map((l) => [l, fs.readFileSync(path.join(ROOT, "locales", `${l}.json`), "utf8")]));
const locales = Object.fromEntries(LANGUAGES.map((l) => [l, JSON.parse(raw[l])]));

describe("server locales", () => {
    test("tab-indented, no trailing newline", () => {
        for (const language of LANGUAGES) expect(raw[language], language).toBe(JSON.stringify(locales[language], null, "\t"));
    });

    test("the same keys in every language", () => {
        const english = keysOf(locales.en).sort();
        for (const language of LANGUAGES) expect(keysOf(locales[language]).sort(), language).toEqual(english);
    });

    test("no empty texts", () => {
        for (const language of LANGUAGES) {
            for (const key of keysOf(locales[language])) {
                const text = key.split(".").reduce((node: any, part) => node[part], locales[language]);
                expect(text, `${language} ${key}`).not.toBe("");
            }
        }
    });

    test("every literal key used in the code exists", () => {
        const used = new Set<string>();
        for (const file of sourceFiles(path.join(ROOT, "src"))) {
            const code = fs.readFileSync(file, "utf8");
            for (const match of code.matchAll(/__n?\(\s*["'`]([^"'`$]+)["'`]/g)) used.add(match[1]);
        }
        expect(used.size).toBeGreaterThan(50);
        for (const key of used) {
            for (const language of LANGUAGES) {
                const value = key.split(".").reduce((node: any, part) => node?.[part], locales[language]);
                expect(value, `${language} ${key}`).toBeDefined();
            }
        }
    });
});

describe("web strings", () => {
    test("the same keys in every language, none empty", () => {
        const english = Object.keys(STRINGS.en).sort();
        for (const language of LANGUAGES) {
            const strings = STRINGS[language as keyof typeof STRINGS];
            expect(Object.keys(strings).sort(), language).toEqual(english);
            for (const [key, text] of Object.entries(strings)) expect(text, `${language} ${key}`).not.toBe("");
        }
    });
});

describe("legal texts", () => {
    test("privacy notice and terms in every language", () => {
        for (const page of ["privacy", "terms"]) {
            for (const language of LANGUAGES) {
                expect(fs.statSync(path.join(ROOT, "legal", `${page}.${language}.html`)).size, `${page}.${language}`).toBeGreaterThan(1000);
            }
        }
    });
});
