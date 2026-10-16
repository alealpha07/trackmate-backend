import { STRINGS } from "./strings.js";

export const LANGUAGES = [
    { id: "en", name: "English" },
    { id: "it", name: "Italiano" },
    { id: "de", name: "Deutsch" },
];
const LANGUAGE_KEY = "trackmate.language";
export const THEMES = ["system", "light", "dark"];
// read before paint by theme-init.js
const THEME_KEY = "trackmate.theme";

function stored(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function store(key, value) {
    try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
    } catch {}
}

// null follows the browser
export function savedLanguage() {
    const id = stored(LANGUAGE_KEY);
    return LANGUAGES.some((language) => language.id === id) ? id : null;
}

export function saveLanguage(id) {
    store(LANGUAGE_KEY, id);
}

function browserLanguage() {
    const ids = LANGUAGES.map((language) => language.id);
    return navigator.languages.map((tag) => tag.slice(0, 2).toLowerCase()).find((id) => ids.includes(id)) ?? "en";
}

export const LANGUAGE = savedLanguage() ?? browserLanguage();
document.documentElement.lang = LANGUAGE;

export function savedTheme() {
    const theme = stored(THEME_KEY);
    return THEMES.includes(theme) ? theme : "system";
}

export function saveTheme(theme) {
    store(THEME_KEY, theme === "system" ? null : theme);
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

export function isDarkTheme() {
    const theme = savedTheme();
    return theme === "dark" || (theme === "system" && darkQuery.matches);
}

export function onSystemThemeChange(listener) {
    darkQuery.addEventListener("change", listener);
}

export function t(key, ...args) {
    const text = STRINGS[LANGUAGE][key] ?? STRINGS.en[key] ?? key;
    return text.replace(/\{(\d+)\}/g, (match, i) => (i < args.length ? String(args[i]) : match));
}

export function legalUrl(page) {
    return `/${page}?lang=${LANGUAGE}`;
}

export function applyTranslations(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll("[data-legal]").forEach((el) => (el.href = legalUrl(el.dataset.legal)));
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
    root.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    root.querySelectorAll("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));
}

// fetch fails with a TypeError in the browser's language and wording
function offline(error) {
    return error instanceof TypeError ? apiError(t("error.offline")) : error;
}

export async function api(method, url, body, options) {
    try {
        return await request(method, url, body, options);
    } catch (error) {
        throw offline(error);
    }
}

async function request(method, url, body, { signal } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Accept-Language": LANGUAGE, ...(body && !isForm ? { "Content-Type": "application/json" } : {}) },
        body: isForm ? body : body ? JSON.stringify(body) : undefined,
        signal,
    });
    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) throw apiError(typeof data === "string" ? data : "", res.status);
    return data;
}

function apiError(message, status) {
    const error = new Error(message || t("error.generic"));
    error.status = status;
    return error;
}

export async function apiStream(method, url, body, options) {
    try {
        return await stream(method, url, body, options);
    } catch (error) {
        throw offline(error);
    }
}

async function stream(method, url, body, { signal, onMessage }) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}stream=1`, {
        method,
        credentials: "same-origin",
        headers: { "Accept-Language": LANGUAGE, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) throw apiError(await res.text(), res.status);

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
        const { value, done } = await reader.read();
        buffer += value ?? "";
        const lines = buffer.split("\n");
        buffer = lines.pop(); // incomplete last line
        for (const line of lines) {
            if (!line.trim()) continue;
            const message = JSON.parse(line);
            if (message.error) throw apiError(message.error, message.status);
            onMessage(message);
        }
        if (done) return;
    }
}
