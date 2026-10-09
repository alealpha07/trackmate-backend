// Shared helpers for the web pages: UI strings and API calls.

// English only for now: other languages get their own table later, picked by navigator.language
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
        "plan.stop": "Stop {0}",
        "plan.stopPlaceholder": "Search or tap the map",
        "plan.addStop": "+ Add stop",
        "plan.removeStop": "Remove stop",
        "plan.reverse": "Reverse the route",
        "plan.north": "Point the map north",
        "plan.locate": "Center on my location",
        "plan.locationUnavailable": "Your location isn't available: allow it for this site in the browser.",
        "plan.mapStyle": "Map style",
        "plan.styleOutdoors": "Outdoors",
        "plan.styleStreets": "Streets",
        "plan.styleLight": "Light",
        "plan.styleDark": "Dark",
        "plan.legLimitHint": "At most 50 km in a straight line between consecutive points.",
        "plan.legTooFar": "{0} → {1} is {2} km in a straight line: at most 50 km between consecutive points.",
        "plan.emptyStop": "Fill in or remove the empty stop.",
        "plan.myLocation": "My location",
        "plan.vehicle": "Vehicle",
        "vehicle.car": "Car",
        "vehicle.motorcycle": "Motorcycle",
        "vehicle.bicycle": "Bicycle",
        "vehicle.foot": "On foot",
        "plan.policy": "Route",
        "plan.safest": "Safest",
        "plan.safestHint": "Lowest injury risk: prefers cycle tracks, bike paths and quiet streets, even if longer",
        "plan.shortest": "Shortest",
        "plan.shortestHint": "Shortest distance on roads open to bikes",
        "plan.safetyFilters": "Safety",
        "plan.preferences": "Preferences",
        "plan.cyclewaysOnly": "Cycleways only",
        "plan.avoidUnpaved": "Avoid unpaved",
        "plan.avoidLts4": "Avoid high-stress roads",
        "plan.cyclewaysOnlyHint": "Cycleways, cycle tracks, bike lanes and bike streets. Other roads only where none connects, as little as possible",
        "plan.avoidUnpavedHint": "Gravel, dirt or grass only where nothing paved connects, as little as possible. Tracks and paths without a mapped surface count as unpaved",
        "plan.avoidLts4Hint": "Roads at the highest level of traffic stress (fast or multi-lane traffic without a separated bike lane) only where nothing else connects, as little as possible",
        "plan.plan": "Plan route",
        "plan.planning": "Planning…",
        "plan.downloading": "Downloading map data: {0} of {1} areas… new areas take a few seconds each.",
        "plan.calculating": "Calculating the route…",
        "plan.planningShort": "Planning…",
        "plan.distance": "Distance",
        "plan.duration": "Estimated time",
        "plan.offBikeways": "Off cycleways",
        "plan.offBikewaysHint": "Length on roads without bike infrastructure, where no cycleway connects",
        "plan.highStress": "High-stress roads",
        "plan.highStressHint": "Length on roads at the highest level of traffic stress, where nothing else connects",
        "plan.unpaved": "Unpaved",
        "plan.unpavedHint": "Length on unpaved roads, where nothing paved connects",
        "plan.save": "Save to my tracks",
        "plan.savePrompt": "Name of the track",
        "plan.saved": "Saved to your tracks!",
        "plan.noResults": "No places found",
        "plan.searchAll": "Search all places (slower) ↵",
        "plan.searchingAll": "Searching all places…",
        "error.generic": "Something went wrong, try again.",
    },
};

/** {0}, {1}… are replaced by `args`. */
export function t(key, ...args) {
    const text = STRINGS.en[key] ?? key;
    return text.replace(/\{(\d+)\}/g, (match, i) => (i < args.length ? String(args[i]) : match));
}

/** Fills elements marked with data-i18n (text), data-i18n-placeholder and data-i18n-title. */
export function applyTranslations(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
    root.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
}

/** Throws an Error with the server message and `status` on non-2xx responses. */
export async function api(method, url, body, { signal } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
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

/** For NDJSON streams (`?stream=1`). A line with `error`, sent after the stream started, throws like api(). */
export async function apiStream(method, url, body, { signal, onMessage }) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}stream=1`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
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
        buffer = lines.pop(); // incomplete last line, if any
        for (const line of lines) {
            if (!line.trim()) continue;
            const message = JSON.parse(line);
            if (message.error) throw apiError(message.error, message.status);
            onMessage(message);
        }
        if (done) return;
    }
}
