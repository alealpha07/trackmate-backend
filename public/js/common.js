// Shared helpers for the web pages: UI strings (EN/IT, like the app) and API calls.

export const LANG = (navigator.language || "en").toLowerCase().startsWith("it") ? "it" : "en";

const STRINGS = {
    en: {
        "auth.username": "Username",
        "auth.password": "Password",
        "auth.confirmPassword": "Confirm password",
        "login.title": "Welcome back",
        "login.subtitle": "Log in to plan your next track.",
        "login.submit": "Log in",
        "login.switch": "No account yet?",
        "login.switchLink": "Register",
        "register.title": "Create your account",
        "register.subtitle": "Join TrackMate to plan and save tracks.",
        "register.submit": "Register",
        "register.switch": "Already have an account?",
        "register.switchLink": "Log in",
        "plan.title": "Plan a track",
        "plan.logout": "Log out",
        "plan.start": "Start",
        "plan.destination": "Destination",
        "plan.startPlaceholder": "Search or tap the map",
        "plan.destinationPlaceholder": "Search or tap the map",
        "plan.swap": "Swap start and destination",
        "plan.myLocation": "My location",
        "plan.vehicle": "Vehicle",
        "plan.bicycle": "Bicycle",
        "plan.policy": "Route",
        "plan.safest": "Safest",
        "plan.shortest": "Shortest",
        "plan.filters": "Filters",
        "plan.cyclewaysOnly": "Cycleways only",
        "plan.avoidUnpaved": "Avoid unpaved",
        "plan.avoidLts4": "Avoid high-stress roads",
        "plan.avoidConstruction": "Avoid construction",
        "plan.comingSoon": "Coming soon",
        "plan.plan": "Plan route",
        "plan.planning": "Planning… the first route in a new area can take up to a minute.",
        "plan.planningShort": "Planning…",
        "plan.distance": "Distance",
        "plan.duration": "Estimated time",
        "plan.save": "Save to my tracks",
        "plan.savePrompt": "Name of the track",
        "plan.saved": "Saved to your tracks!",
        "plan.noResults": "No places found",
        "plan.searchAll": "Search all places (slower) ↵",
        "plan.searchingAll": "Searching all places…",
        "error.generic": "Something went wrong, try again.",
    },
    it: {
        "auth.username": "Nome utente",
        "auth.password": "Password",
        "auth.confirmPassword": "Conferma password",
        "login.title": "Bentornato",
        "login.subtitle": "Accedi per pianificare il tuo prossimo tracciato.",
        "login.submit": "Accedi",
        "login.switch": "Non hai un account?",
        "login.switchLink": "Registrati",
        "register.title": "Crea il tuo account",
        "register.subtitle": "Unisciti a TrackMate per pianificare e salvare tracciati.",
        "register.submit": "Registrati",
        "register.switch": "Hai già un account?",
        "register.switchLink": "Accedi",
        "plan.title": "Pianifica un tracciato",
        "plan.logout": "Esci",
        "plan.start": "Partenza",
        "plan.destination": "Destinazione",
        "plan.startPlaceholder": "Cerca o tocca la mappa",
        "plan.destinationPlaceholder": "Cerca o tocca la mappa",
        "plan.swap": "Inverti partenza e destinazione",
        "plan.myLocation": "La mia posizione",
        "plan.vehicle": "Veicolo",
        "plan.bicycle": "Bicicletta",
        "plan.policy": "Percorso",
        "plan.safest": "Più sicuro",
        "plan.shortest": "Più breve",
        "plan.filters": "Filtri",
        "plan.cyclewaysOnly": "Solo piste ciclabili",
        "plan.avoidUnpaved": "Evita sterrati",
        "plan.avoidLts4": "Evita strade ad alto stress",
        "plan.avoidConstruction": "Evita cantieri",
        "plan.comingSoon": "In arrivo",
        "plan.plan": "Calcola percorso",
        "plan.planning": "Calcolo in corso… il primo percorso in una nuova zona può richiedere fino a un minuto.",
        "plan.planningShort": "Calcolo…",
        "plan.distance": "Distanza",
        "plan.duration": "Tempo stimato",
        "plan.save": "Salva nei miei tracciati",
        "plan.savePrompt": "Nome del tracciato",
        "plan.saved": "Salvato nei tuoi tracciati!",
        "plan.noResults": "Nessun luogo trovato",
        "plan.searchAll": "Cerca in tutti i luoghi (più lento) ↵",
        "plan.searchingAll": "Ricerca in tutti i luoghi…",
        "error.generic": "Qualcosa è andato storto, riprova.",
    },
};

export function t(key) {
    return STRINGS[LANG][key] ?? STRINGS.en[key] ?? key;
}

/** Fills elements marked with data-i18n (text), data-i18n-placeholder and data-i18n-title. */
export function applyTranslations(root = document) {
    document.documentElement.lang = LANG;
    root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
    root.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
}

/** Calls the backend with the session cookie and `lang`, so server messages come back translated.
 * Throws an Error carrying the server message and `status` on non-2xx responses.
 * `signal` (optional) cancels the request: it then rejects with an AbortError. */
export async function api(method, url, body, { signal } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}lang=${LANG}`, {
        method,
        credentials: "same-origin",
        headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
        body: isForm ? body : body ? JSON.stringify(body) : undefined,
        signal,
    });
    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
        const error = new Error(typeof data === "string" && data ? data : t("error.generic"));
        error.status = res.status;
        throw error;
    }
    return data;
}
