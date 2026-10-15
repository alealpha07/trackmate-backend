import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { renderPage } from "../pages.js";

const router = express.Router();

const LEGAL_DIR = path.join(import.meta.dirname, "..", "..", "legal");
// bump when a text changes
const UPDATED = { privacy: "2026-10-15", terms: "2026-10-15" };
const LANGUAGES = [
    { id: "en", name: "English" },
    { id: "it", name: "Italiano" },
    { id: "de", name: "Deutsch" },
];

const STYLE = `
        main { display: flex; justify-content: center; padding: 24px 16px; }`;
const EMBEDDED_STYLE = `
        body { background: transparent; }
        main { padding: 0; }
        .legal { max-width: none; border-radius: 0; box-shadow: none; padding: 16px; background: transparent; }`;

function legalPage(name: keyof typeof UPDATED) {
    return (req: Request, res: Response) => {
        try {
            // the app shows the page in a WebView
            const embedded = req.query.app === "1";
            const lang = LANGUAGES.some((language) => language.id === res.getLocale()) ? res.getLocale() : "en";
            const text = fs.readFileSync(path.join(LEGAL_DIR, `${name}.${lang}.html`), "utf8");
            const title = res.__(`legal.${name}`);
            const updated = new Intl.DateTimeFormat(lang, { dateStyle: "long" }).format(new Date(UPDATED[name]));
            const languages = LANGUAGES
                .map((language) => language.id === lang
                    ? `<strong>${language.name}</strong>`
                    : `<a href="?lang=${language.id}" hreflang="${language.id}">${language.name}</a>`)
                .join(" · ");
            res.type("html").send(renderPage(res, {
                title: `${title} · TrackMate`,
                style: embedded ? EMBEDDED_STYLE : STYLE,
                embedded,
                body: `
    <article class="card legal">${embedded ? "" : `
        <nav class="languages">${languages}</nav>
        <h1>${title}</h1>`}
        <p class="muted">${res.__("legal.updated", updated)}</p>
${text}
    </article>`,
            }));
        } catch (error) {
            console.error(error);
            res.status(500).send(res.__("server.error"));
        }
    };
}

router.get("/privacy", legalPage("privacy"));
router.get("/terms", legalPage("terms"));

export default router;
