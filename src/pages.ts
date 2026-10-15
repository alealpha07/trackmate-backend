import { Response } from "express";

export const escapeHtml = (text: string) =>
    text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

// embedded pages sit under the app's own toolbar, so no header or footer
type Page = { title: string; meta?: string; style?: string; body: string; embedded?: boolean };

// shell of the pages rendered on the server, with the privacy and terms links in the footer
export function renderPage(res: Response, { title, meta = "", style = "", body, embedded = false }: Page) {
    const lang = res.getLocale();
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>${meta}
    <link rel="icon" href="/img/icon.webp">
    <link rel="stylesheet" href="/vendor/roboto/400.css">
    <link rel="stylesheet" href="/vendor/roboto/500.css">
    <link rel="stylesheet" href="/vendor/roboto/700.css">
    <link rel="stylesheet" href="/theme.css">
    <script src="/js/theme-init.js"></script>${style ? `
    <style>${style}
    </style>` : ""}
</head>
<body>${embedded ? "" : `
    <header class="app-bar"><img class="app-icon" src="/img/icon.webp" alt=""><h1>TrackMate</h1></header>`}
    <main>${body}
    </main>${embedded ? "" : `
    <footer class="legal-links"><a href="/privacy?lang=${lang}">${res.__("legal.privacy")}</a> · <a href="/terms?lang=${lang}">${res.__("legal.terms")}</a></footer>`}
</body>
</html>`;
}
