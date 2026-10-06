// Web track planner: pick start and destination (search or map tap), call POST /route/plan,
// draw the route and optionally save it to the user's tracks.
import { api, applyTranslations, t, LANG } from "./common.js";

applyTranslations();

// Logged-in users only
try {
    await api("GET", "/auth/user");
} catch (err) {
    if (err.status !== 401) throw err;
    location.replace("/login");
    await new Promise(() => {}); // stop here while the browser navigates away
}

// Initial view when the browser doesn't share its location
const DEFAULT_CENTER = [10.3279, 44.8015]; // Parma
const DEFAULT_ZOOM = 13;
const SEARCH_MIN_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 300;

// Same Stadia raster styles as the app (OsmTileSource.kt). Web uses Stadia domain auth, so no key here.
const ATTRIBUTION = '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> '
    + '&copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> '
    + '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const darkScheme = matchMedia("(prefers-color-scheme: dark)");

function tileUrls() {
    const style = darkScheme.matches ? "alidade_smooth_dark" : "outdoors";
    const retina = devicePixelRatio > 1 ? "@2x" : "";
    return [`https://tiles.stadiamaps.com/tiles/${style}/{z}/{x}/{y}${retina}.png`];
}

function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const map = new maplibregl.Map({
    container: "map",
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    attributionControl: { compact: true },
    style: {
        version: 8,
        sources: {
            basemap: { type: "raster", tiles: tileUrls(), tileSize: 256, maxzoom: 20, attribution: ATTRIBUTION },
            route: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
            { id: "basemap", type: "raster", source: "basemap" },
            {
                id: "route-casing", type: "line", source: "route",
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": cssVar("--card"), "line-width": 9 },
            },
            {
                id: "route", type: "line", source: "route",
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": cssVar("--primary"), "line-width": 5 },
            },
        ],
    },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

darkScheme.addEventListener("change", () => {
    map.getSource("basemap").setTiles(tileUrls());
    map.setPaintProperty("route", "line-color", cssVar("--primary"));
    map.setPaintProperty("route-casing", "line-color", cssVar("--card"));
    // Marker colours come from the theme too: redraw them
    for (const which of ["start", "end"]) {
        removeMarker(which);
        drawMarker(which);
    }
});

// #region state
const points = { start: null, end: null }; // { lat, lng, label }
const markers = { start: null, end: null };
let activeField = "start"; // which field a map tap fills
let currentRoute = null;
let planSequence = 0; // ignore responses of outdated requests
let planController = null; // aborts the previous request, so the server stops fetching map data for it

const inputs = { start: document.getElementById("start-input"), end: document.getElementById("end-input") };
const planButton = document.getElementById("plan");
const status = document.getElementById("status");
const result = document.getElementById("result");
const saveButton = document.getElementById("save");
// #endregion

function formatCoordinates({ lat, lng }) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function removeMarker(which) {
    markers[which]?.remove();
    markers[which] = null;
}

function drawMarker(which) {
    const point = points[which];
    if (!point) return;
    if (!markers[which]) {
        markers[which] = new maplibregl.Marker({ color: cssVar(which === "start" ? "--start" : "--primary"), draggable: true })
            .setLngLat([point.lng, point.lat])
            .addTo(map);
        markers[which].on("dragend", () => {
            const { lat, lng } = markers[which].getLngLat();
            setPoint(which, { lat, lng, label: null });
        });
    } else {
        markers[which].setLngLat([point.lng, point.lat]);
    }
}

function setPoint(which, point, { fly = false } = {}) {
    points[which] = point;
    inputs[which].value = point ? point.label || formatCoordinates(point) : "";
    if (point) drawMarker(which);
    else removeMarker(which);
    if (fly && point) map.flyTo({ center: [point.lng, point.lat], zoom: Math.max(map.getZoom(), 14) });
    routeChanged();
}

/** Points or options changed: the shown route is outdated. Planning (and the map data download
 * on the server) only starts on "Plan route", so nothing is fetched until the user asks. */
function routeChanged() {
    cancelPlanning();
    clearRoute();
    showStatus("");
    setPlanning(false);
}

function cancelPlanning() {
    planSequence++;
    planController?.abort();
    planController = null;
}

/** Spinner and label on the Plan button while a request runs. */
function setPlanning(planning) {
    planButton.classList.toggle("loading", planning);
    planButton.setAttribute("aria-busy", String(planning));
    planButton.querySelector(".label").textContent = t(planning ? "plan.planningShort" : "plan.plan");
    planButton.disabled = planning || !(points.start && points.end);
}

function clearRoute() {
    currentRoute = null;
    result.hidden = true;
    map.getSource("route")?.setData({ type: "FeatureCollection", features: [] });
}

function showStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle("error", isError);
    status.hidden = !text;
}

function formatDistance(meters) {
    const km = new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(meters / 1000);
    return `${km} km`;
}

function formatDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

function selectedOptions() {
    const filters = {};
    document.querySelectorAll(".filters input").forEach((input) => (filters[input.name] = input.checked));
    return {
        vehicle: document.getElementById("vehicle").value,
        policy: document.querySelector("input[name=policy]:checked").value,
        filters,
    };
}

async function plan() {
    if (!points.start || !points.end) return;
    cancelPlanning();
    const sequence = planSequence;
    planController = new AbortController();
    clearRoute();
    setPlanning(true);
    showStatus(t("plan.planning"));
    try {
        const route = await api("POST", "/route/plan", {
            start: { lat: points.start.lat, lng: points.start.lng },
            end: { lat: points.end.lat, lng: points.end.lng },
            ...selectedOptions(),
        }, { signal: planController.signal });
        if (sequence !== planSequence) return;
        currentRoute = route;
        const coordinates = route.track.map((p) => [p.lng, p.lat]);
        map.getSource("route").setData({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} });
        const bounds = coordinates.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 16 });
        document.getElementById("distance").textContent = formatDistance(route.distance);
        document.getElementById("duration").textContent = formatDuration(route.duration);
        result.hidden = false;
        showStatus("");
    } catch (err) {
        if (sequence !== planSequence || err.name === "AbortError") return;
        if (err.status === 401) return location.replace("/login");
        showStatus(err.message, true);
    } finally {
        if (sequence === planSequence) setPlanning(false);
    }
}

/** Keeps the route clear of the panel (left on desktop, bottom sheet on phones). */
function fitPadding() {
    const panel = document.querySelector(".panel").getBoundingClientRect();
    if (innerWidth <= 640) return { top: 60, right: 40, left: 40, bottom: panel.height + 40 };
    return { top: 60, right: 60, bottom: 60, left: panel.right + 40 };
}

// #region place search
function setupSearch(which) {
    const input = inputs[which];
    const list = input.parentElement.querySelector(".suggestions");
    let timer = null;
    let searchSequence = 0;
    let fullText = null; // text whose full results (Stadia + Photon) are shown

    const hide = () => (list.hidden = true);

    function listButton(text, onClick, className = "") {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = text;
        // mousedown fires before the input's blur hides the list
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", onClick);
        li.append(button);
        return li;
    }

    function render(items, full) {
        list.replaceChildren();
        if (items.length === 0) {
            const empty = document.createElement("li");
            empty.className = "empty";
            empty.textContent = t("plan.noResults");
            list.append(empty);
        }
        for (const item of items) {
            list.append(listButton(item.label, () => {
                hide();
                setPoint(which, item, { fly: true });
            }, "result"));
        }
        // Stadia misses small villages: offer the slower full search
        if (!full) list.append(listButton(t("plan.searchAll"), searchAll, "search-all"));
        list.hidden = false;
    }

    function renderMessage(text) {
        list.replaceChildren();
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = text;
        list.append(li);
        list.hidden = false;
    }

    async function search(text, full) {
        const sequence = ++searchSequence;
        const center = map.getCenter();
        const query = new URLSearchParams({ text, lat: center.lat.toFixed(4), lng: center.lng.toFixed(4) });
        if (full) query.set("full", "1");
        try {
            const items = await api("GET", `/route/geocode?${query}`);
            if (sequence !== searchSequence || document.activeElement !== input) return;
            fullText = full ? text : null;
            render(items, full);
        } catch (err) {
            if (sequence === searchSequence && document.activeElement === input) renderMessage(err.message);
        }
    }

    function searchAll() {
        const text = input.value.trim();
        if (text.length < SEARCH_MIN_CHARS) return;
        clearTimeout(timer);
        renderMessage(t("plan.searchingAll"));
        search(text, true);
    }

    input.addEventListener("focus", () => (activeField = which));
    input.addEventListener("blur", hide);
    input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hide();
        if (event.key !== "Enter") return;
        // First Enter: search all places. Enter again on those results: pick the first one
        if (fullText === input.value.trim() && !list.hidden) list.querySelector("button.result")?.click();
        else searchAll();
    });
    input.addEventListener("input", () => {
        clearTimeout(timer);
        fullText = null;
        const text = input.value.trim();
        if (text.length < SEARCH_MIN_CHARS) return hide();
        timer = setTimeout(() => search(text, false), SEARCH_DEBOUNCE_MS);
    });
}
setupSearch("start");
setupSearch("end");
// #endregion

// Map tap fills the active field; after the start, move on to the destination
map.on("click", (event) => {
    const which = activeField;
    if (which === "start" && !points.end) activeField = "end";
    setPoint(which, { lat: event.lngLat.lat, lng: event.lngLat.lng, label: null });
});

document.getElementById("swap").addEventListener("click", () => {
    const { start, end } = points;
    points.start = end;
    points.end = start;
    for (const which of ["start", "end"]) {
        removeMarker(which);
        inputs[which].value = points[which] ? points[which].label || formatCoordinates(points[which]) : "";
        drawMarker(which);
    }
    routeChanged();
});

planButton.addEventListener("click", plan);
document.querySelectorAll("input[name=policy], .filters input, #vehicle").forEach((el) => el.addEventListener("change", routeChanged));

saveButton.addEventListener("click", async () => {
    if (!currentRoute) return;
    const defaultName = [points.start, points.end].map((p) => p.label || formatCoordinates(p)).join(" → ");
    const name = prompt(t("plan.savePrompt"), defaultName)?.trim();
    if (!name) return;
    saveButton.disabled = true;
    let trackId = null;
    try {
        trackId = (await api("POST", "/track", { name })).id;
        const form = new FormData();
        form.append("file", new Blob([JSON.stringify(currentRoute)], { type: "application/json" }), "track.json");
        await api("POST", `/track/file?id=${trackId}`, form);
        showStatus(t("plan.saved"));
    } catch (err) {
        // Don't leave a track without its file behind
        if (trackId !== null) api("DELETE", `/track?id=${trackId}`).catch(() => {});
        showStatus(err.message, true);
    } finally {
        saveButton.disabled = false;
    }
});

document.getElementById("logout").addEventListener("click", async () => {
    await api("POST", "/auth/logout").catch(() => {});
    location.replace("/login");
});

// Start defaults to the browser's location (needs HTTPS or localhost)
navigator.geolocation?.getCurrentPosition(
    (position) => {
        if (points.start) return;
        const here = { lat: position.coords.latitude, lng: position.coords.longitude, label: t("plan.myLocation") };
        map.jumpTo({ center: [here.lng, here.lat], zoom: 14 });
        setPoint("start", here);
        activeField = "end";
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10_000 },
);
