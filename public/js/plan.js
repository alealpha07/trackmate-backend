import * as maplibregl from "/vendor/maplibre-gl/maplibre-gl.mjs";
import {
    api, apiStream, applyTranslations, legalUrl, t, LANGUAGE, LANGUAGES, THEMES, savedLanguage, saveLanguage, savedTheme,
    saveTheme, isDarkTheme, onSystemThemeChange,
} from "./common.js";

applyTranslations();

const DEFAULT_CENTER = [10.3279, 44.8015]; // Parma
const DEFAULT_ZOOM = 13;
const SEARCH_MIN_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 300;
// same limit as the server
const MAX_LEG_METERS = 50_000;
const EARTH_RADIUS_METERS = 6_371_008.8;
// percent over the shortest route, null for no limit
const MAX_DETOUR_STOPS = [10, 15, 25, 50, null];
// same limits as the server
const MAX_STOPS = 10;
const MAX_NAME_LENGTH = 100;

// stadia's credit is its own control so it never folds, the rest is on /credits
const ATTRIBUTION = '&copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> '
    + '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> '
    + `| <a href="/credits" target="_blank">${t("plan.credits")}</a>`;
// osm allows a folded credit if it starts open and folds on the first touch or after a few seconds
const ATTRIBUTION_COLLAPSE_MS = 5000;
const MAP_STYLES = [
    { id: "auto", label: "plan.styleAuto" },
    { id: "outdoors", label: "plan.styleOutdoors" },
    { id: "osm_bright", label: "plan.styleStreets" },
    { id: "alidade_smooth", label: "plan.styleLight" },
    { id: "alidade_smooth_dark", label: "plan.styleDark" },
];
const MAP_STYLE_KEY = "trackmate.mapStyle";
const AUTO_STYLES = { light: "outdoors", dark: "alidade_smooth_dark" };
const THEME_LABELS = { system: "plan.themeSystem", light: "plan.themeLight", dark: "plan.themeDark" };
// same icons as the app
const SETTINGS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z"/></svg>';
const LAYERS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>';
const LOCATION_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
const COMPASS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="north" d="M12 2.5 15.5 12h-7z"/><path class="south" d="M12 21.5 15.5 12h-7z"/><circle class="pivot" cx="12" cy="12" r="1.3"/></svg>';
const LOCATION_ZOOM = 16;

function savedMapStyle() {
    try {
        const id = localStorage.getItem(MAP_STYLE_KEY);
        return MAP_STYLES.find((style) => style.id === id)?.id ?? MAP_STYLES[0].id;
    } catch {
        return MAP_STYLES[0].id;
    }
}

function shownMapStyle() {
    const style = savedMapStyle();
    if (style !== "auto") return style;
    return isDarkTheme() ? AUTO_STYLES.dark : AUTO_STYLES.light;
}

function tileUrls(style) {
    const retina = devicePixelRatio > 1 ? "@2x" : "";
    // no api key needed, stadia uses domain auth
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
    locale: {
        "NavigationControl.ZoomIn": t("map.zoomIn"),
        "NavigationControl.ZoomOut": t("map.zoomOut"),
        "AttributionControl.ToggleAttribution": t("map.toggleAttribution"),
    },
    style: {
        version: 8,
        sources: {
            basemap: { type: "raster", tiles: tileUrls(shownMapStyle()), tileSize: 256, maxzoom: 20, attribution: ATTRIBUTION },
            route: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            connectors: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
            { id: "basemap", type: "raster", source: "basemap" },
            {
                // line from each point to the road it snapped to
                id: "connectors", type: "line", source: "connectors",
                layout: { "line-cap": "round" },
                paint: { "line-color": cssVar("--map-accent"), "line-width": 3, "line-dasharray": [0.5, 2] },
            },
            {
                id: "route", type: "line", source: "route",
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": cssVar("--map-accent"), "line-width": 5 },
            },
        ],
    },
});
class ButtonControl {
    constructor(className, label, icon, onClick) {
        this.container = document.createElement("div");
        this.container.className = `maplibregl-ctrl maplibregl-ctrl-group ${className}`;
        this.button = document.createElement("button");
        this.button.type = "button";
        this.button.title = label;
        this.button.setAttribute("aria-label", label);
        this.button.innerHTML = icon;
        this.button.addEventListener("click", onClick);
        this.container.append(this.button);
    }

    onAdd() {
        return this.container;
    }

    onRemove() {}
}

// a map button that opens a card of radio groups
class MenuControl {
    constructor(className, label, icon, groups, links = []) {
        this.className = className;
        this.label = label;
        this.icon = icon;
        this.groups = groups;
        this.links = links;
    }

    onAdd() {
        const container = document.createElement("div");
        container.className = `maplibregl-ctrl maplibregl-ctrl-group menu-control ${this.className}`;

        const button = document.createElement("button");
        button.type = "button";
        button.title = this.label;
        button.setAttribute("aria-label", this.label);
        button.setAttribute("aria-expanded", "false");
        button.innerHTML = this.icon;

        const menu = document.createElement("div");
        menu.className = "control-menu card";
        menu.hidden = true;
        for (const group of this.groups) {
            const fieldset = document.createElement("fieldset");
            const legend = document.createElement("legend");
            legend.textContent = group.title;
            fieldset.append(legend);
            for (const option of group.options) {
                const label = document.createElement("label");
                const radio = document.createElement("input");
                radio.type = "radio";
                radio.name = group.name;
                radio.value = option.id;
                radio.checked = option.id === group.current;
                radio.addEventListener("change", () => {
                    group.onChange(option.id);
                    toggle(false);
                });
                label.append(radio, option.label);
                fieldset.append(label);
            }
            menu.append(fieldset);
        }
        if (this.links.length > 0) {
            const nav = document.createElement("nav");
            nav.className = "menu-links";
            for (const link of this.links) {
                const a = document.createElement("a");
                a.href = link.href;
                a.target = "_blank";
                a.textContent = link.label;
                nav.append(a);
            }
            menu.append(nav);
        }

        const toggle = (open) => {
            menu.hidden = !open;
            button.setAttribute("aria-expanded", String(open));
        };
        button.addEventListener("click", () => toggle(menu.hidden));
        document.addEventListener("click", (event) => {
            if (!container.contains(event.target)) toggle(false);
        });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || menu.hidden) return;
            const wasInside = container.contains(document.activeElement);
            toggle(false);
            if (wasInside) button.focus();
        });

        container.append(button, menu);
        return container;
    }

    onRemove() {}
}

map.addControl(new MenuControl("settings", t("plan.settings"), SETTINGS_ICON, [
    {
        name: "theme",
        title: t("plan.theme"),
        options: THEMES.map((theme) => ({ id: theme, label: t(THEME_LABELS[theme]) })),
        current: savedTheme(),
        onChange: (theme) => {
            saveTheme(theme);
            updateBasemap();
        },
    },
    {
        name: "language",
        title: t("plan.language"),
        options: [{ id: "system", label: t("plan.languageSystem") }, ...LANGUAGES.map(({ id, name }) => ({ id, label: name }))],
        current: savedLanguage() ?? "system",
        onChange: (id) => {
            saveLanguage(id === "system" ? null : id);
            // every string is rendered once, so start over in the new language
            location.reload();
        },
    },
], [
    { href: legalUrl("privacy"), label: t("legal.privacy") },
    { href: legalUrl("terms"), label: t("legal.terms") },
]), "top-right");

// compass only shows when the map is rotated or tilted
const compass = new ButtonControl("compass", t("plan.north"), COMPASS_ICON, () => map.easeTo({ bearing: 0, pitch: 0 }));
map.addControl(compass, "top-right");
function updateCompass() {
    compass.container.hidden = map.getBearing() === 0 && map.getPitch() === 0;
    compass.button.firstChild.style.transform = `rotate(${-map.getBearing()}deg)`;
}
map.on("rotate", updateCompass);
map.on("pitch", updateCompass);
updateCompass();

map.addControl(new MenuControl("layers", t("plan.mapStyle"), LAYERS_ICON, [{
    name: "map-style",
    title: t("plan.mapStyle"),
    options: MAP_STYLES.map((style) => ({ id: style.id, label: t(style.label) })),
    current: savedMapStyle(),
    onChange: (id) => {
        try {
            localStorage.setItem(MAP_STYLE_KEY, id);
        } catch {}
        updateBasemap();
    },
}]), "top-right");

let basemapStyle = shownMapStyle();
function updateBasemap() {
    if (shownMapStyle() === basemapStyle) return;
    basemapStyle = shownMapStyle();
    map.getSource("basemap").setTiles(tileUrls(basemapStyle));
}
onSystemThemeChange(updateBasemap);

const myLocationMarker = new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "my-location" }) });

function showMyLocation(position) {
    myLocationMarker.setLngLat([position.coords.longitude, position.coords.latitude]).addTo(map);
}

// Geolocation needs HTTPS or localhost
if (navigator.geolocation) {
    map.addControl(new ButtonControl("locate", t("plan.locate"), LOCATION_ICON, () => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                showMyLocation(position);
                map.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: LOCATION_ZOOM });
            },
            () => showStatus(t("plan.locationUnavailable"), true),
            { enableHighAccuracy: true, timeout: 10_000 },
        );
    }), "top-right");
}
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

class StadiaCredit {
    onAdd() {
        const container = document.createElement("div");
        container.className = "maplibregl-ctrl stadia-credit";
        container.innerHTML = '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a>';
        return container;
    }

    onRemove() {}
}
map.addControl(new StadiaCredit(), "bottom-right");

// maplibre only folds the credit on drag
function collapseAttribution() {
    clearTimeout(collapseTimer);
    map.getCanvasContainer().removeEventListener("pointerdown", collapseAttribution);
    document.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show .maplibregl-ctrl-attrib-button")?.click();
}
const collapseTimer = setTimeout(collapseAttribution, ATTRIBUTION_COLLAPSE_MS);
map.getCanvasContainer().addEventListener("pointerdown", collapseAttribution);

// on phones the panel is a bottom sheet, the credits ride on top of it
const panel = document.querySelector(".panel");
new ResizeObserver(() => document.documentElement.style.setProperty("--panel-height", `${panel.offsetHeight}px`)).observe(panel);

// #region state
const rows = [];
let activeRow = null; // the row a map tap fills
let currentRoute = null;
let planSequence = 0; // ignore responses of outdated requests
let planController = null; // to cancel the previous plan request
let listCount = 0; // for unique element ids
let stopCount = 0;

const pointList = document.getElementById("point-list");
const stopTemplate = document.getElementById("stop-template");
const planButton = document.getElementById("plan");
const status = document.getElementById("status");
const result = document.getElementById("result");
const legsList = document.getElementById("legs");
const pointsHint = document.querySelector(".points .hint");
const saveButton = document.getElementById("save");
// #endregion

function formatCoordinates({ lat, lng }) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// accepts "44.8, 10.3", "44.8 10.3", "44,8; 10,3" and "44,8, 10,3"
function coordinateNumbers(text) {
    const match = text.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)
        ?? text.match(/^(-?\d+(?:,\d+)?)\s*(?:[;\s]|,\s)\s*(-?\d+(?:,\d+)?)$/);
    return match ? [match[1], match[2]].map((value) => Number(value.replace(",", "."))) : null;
}

const inRange = ([lat, lng]) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function parseCoordinates(text) {
    const numbers = coordinateNumbers(text);
    if (!numbers || !inRange(numbers)) return null;
    return { lat: numbers[0], lng: numbers[1], label: null };
}

const outOfRange = (text) => {
    const numbers = coordinateNumbers(text);
    return numbers !== null && !inRange(numbers);
};

function pointText(point) {
    return point ? point.label || formatCoordinates(point) : "";
}

const isStop = (row) => row !== rows[0] && row !== rows[rows.length - 1];

function rowName(index) {
    if (index === 0) return t("plan.start");
    if (index === rows.length - 1) return t("plan.destination");
    return t("plan.stop", index);
}

function removeMarker(row) {
    row.marker?.remove();
    row.marker = null;
}

function pinLabel(row) {
    if (row === rows[0]) return "A";
    if (row === rows[rows.length - 1]) return "B";
    return String(rows.indexOf(row));
}

function drawMarker(row) {
    if (!row.point) return;
    if (!row.marker) {
        const element = document.createElement("div");
        element.className = "map-pin";
        element.textContent = pinLabel(row);
        row.marker = new maplibregl.Marker({ element, draggable: true }).setLngLat([row.point.lng, row.point.lat]).addTo(map);
        row.marker.on("dragend", () => {
            const { lat, lng } = row.marker.getLngLat();
            setPoint(row, { lat, lng, label: null });
        });
    } else {
        row.marker.setLngLat([row.point.lng, row.point.lat]);
    }
}

function setPoint(row, point, { fly = false } = {}) {
    row.point = point;
    row.input.value = pointText(point);
    if (point) drawMarker(row);
    else removeMarker(row);
    if (fly && point) map.flyTo({ center: [point.lng, point.lat], zoom: Math.max(map.getZoom(), 14) });
    routeChanged();
}

function renumberStops() {
    rows.forEach((row, index) => {
        if (!isStop(row)) return;
        row.element.querySelector(".name").textContent = rowName(index);
        row.element.querySelector(".pin").textContent = pinLabel(row);
        if (row.marker) row.marker.getElement().textContent = pinLabel(row);
    });
}

function routeChanged() {
    cancelPlanning();
    clearRoute();
    showStatus("");
    const problem = routeProblem();
    pointsHint.textContent = problem ?? t("plan.legLimitHint");
    pointsHint.classList.toggle("error", problem !== null);
    setPlanning(false);
}

function routeProblem() {
    rows.forEach((row) => row.element.classList.remove("too-far"));
    if (!rows[0].point || !rows[rows.length - 1].point) return null; // nothing to say yet
    if (rows.some((row) => !row.point)) return t("plan.emptyStop");
    for (let i = 0; i < rows.length - 1; i++) {
        const meters = haversineMeters(rows[i].point, rows[i + 1].point);
        if (meters > MAX_LEG_METERS) {
            rows[i].element.classList.add("too-far");
            rows[i + 1].element.classList.add("too-far");
            const km = new Intl.NumberFormat(LANGUAGE, { maximumFractionDigits: 1 }).format(meters / 1000);
            return t("plan.legTooFar", rowName(i), rowName(i + 1), km);
        }
    }
    return null;
}

function haversineMeters(a, b) {
    const rad = (deg) => (deg * Math.PI) / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
        + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function cancelPlanning() {
    planSequence++;
    planController?.abort();
    planController = null;
}

function setPlanning(planning) {
    planButton.classList.toggle("loading", planning);
    planButton.setAttribute("aria-busy", String(planning));
    planButton.querySelector(".label").textContent = t(planning ? "plan.planningShort" : "plan.plan");
    planButton.disabled = planning || rows.some((row) => !row.point) || routeProblem() !== null;
}

function clearRoute() {
    currentRoute = null;
    result.hidden = true;
    map.getSource("route")?.setData({ type: "FeatureCollection", features: [] });
    map.getSource("connectors")?.setData({ type: "FeatureCollection", features: [] });
}

function showStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle("error", isError);
    status.hidden = !text;
}

function formatDistance(meters) {
    const km = new Intl.NumberFormat(LANGUAGE, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(meters / 1000);
    return `${km} km`;
}

function formatDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

function updateFilterGroups() {
    const vehicle = document.getElementById("vehicle").value;
    const policy = document.querySelector("input[name=policy]:checked").value;
    document.querySelectorAll(".filters").forEach((group) => {
        const { vehicle: forVehicle, policy: forPolicy } = group.dataset;
        group.hidden = (forVehicle && forVehicle !== vehicle) || (forPolicy && forPolicy !== policy);
    });
}

function maxDetour() {
    const slider = document.querySelector("input[name=maxDetour]");
    return slider.closest(".filters").hidden ? null : MAX_DETOUR_STOPS[Number(slider.value)];
}

function showMaxDetour() {
    const value = MAX_DETOUR_STOPS[Number(document.querySelector("input[name=maxDetour]").value)];
    const text = value === null ? t("plan.noLimit") : `${value}%`;
    document.getElementById("max-detour-value").textContent = text;
    document.querySelector("input[name=maxDetour]").setAttribute("aria-valuetext", text);
}

function selectedOptions() {
    const filters = {};
    document.querySelectorAll(".filters:not([hidden]) input[type=checkbox]").forEach((input) => (filters[input.name] = input.checked));
    const options = {
        vehicle: document.getElementById("vehicle").value,
        policy: document.querySelector("input[name=policy]:checked").value,
        filters,
    };
    if (maxDetour() !== null) options.maxDetour = maxDetour();
    return options;
}

async function plan() {
    if (rows.some((row) => !row.point) || routeProblem()) return;
    // the button is disabled while busy, which drops its focus
    const hadFocus = document.activeElement === planButton;
    cancelPlanning();
    const sequence = planSequence;
    planController = new AbortController();
    clearRoute();
    setPlanning(true);
    showStatus(t("plan.planning"));
    const [start, ...rest] = rows.map((row) => ({ lat: row.point.lat, lng: row.point.lng }));
    const end = rest.pop();
    const options = selectedOptions();
    try {
        let route = null;
        await apiStream("POST", "/route/plan", { start, via: rest, end, ...options }, {
            signal: planController.signal,
            onMessage: (message) => {
                if (sequence !== planSequence) return;
                if (message.route) route = message.route;
                const progress = message.progress;
                if (progress?.total > 0) {
                    showStatus(progress.done < progress.total
                        ? t("plan.downloading", progress.done, progress.total)
                        : t("plan.calculating"));
                }
            },
        });
        if (sequence !== planSequence) return;
        if (!route) throw new Error(t("error.generic"));
        showRoute({ ...route, vehicle: options.vehicle });
    } catch (err) {
        if (sequence !== planSequence || err.name === "AbortError") return;
        if (err.status === 401) return location.replace("/login");
        showStatus(err.message, true);
    } finally {
        if (sequence === planSequence) {
            setPlanning(false);
            if (hadFocus && document.activeElement === document.body) (result.hidden ? planButton : result).focus();
        }
    }
}

function showSoftStat(id, meters) {
    document.getElementById(`${id}-item`).hidden = meters === undefined;
    if (meters !== undefined) document.getElementById(id).textContent = formatDistance(meters);
}

function showRoute(route) {
    currentRoute = route;
    const coordinates = route.track.map((p) => [p.lng, p.lat]);
    map.getSource("route").setData({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} });
    map.getSource("connectors").setData({ type: "FeatureCollection", features: connectorLines(route) });
    const bounds = [...coordinates, ...rows.map((row) => [row.point.lng, row.point.lat])]
        .reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
    map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 16 });
    document.getElementById("distance").textContent = formatDistance(route.distance);
    document.getElementById("duration").textContent = formatDuration(route.duration);
    showSoftStat("off-bikeways", route.offBikeways);
    showSoftStat("high-stress", route.highStress);
    showSoftStat("unpaved", route.unpaved);

    legsList.replaceChildren(...(route.legs.length > 1 ? route.legs : []).map((leg, i) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "leg-name";
        name.textContent = `${rowName(i)} → ${rowName(i + 1)}`;
        const value = document.createElement("span");
        value.className = "leg-value";
        value.textContent = `${formatDistance(leg.distance)} · ${formatDuration(leg.duration)}`;
        li.append(name, value);
        return li;
    }));
    legsList.hidden = route.legs.length < 2;
    result.hidden = false;
    showStatus("");
}

function connectorLines(route) {
    const line = (point, end) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[point.lng, point.lat], [end.lng, end.lat]] },
        properties: {},
    });
    // skip tiny gaps, round caps would draw a dot
    const visible = ([a, b]) => new maplibregl.LngLat(a.lng, a.lat).distanceTo(new maplibregl.LngLat(b.lng, b.lat)) > 10;
    return route.legs
        .flatMap((leg, i) => [[rows[i].point, leg.from], [rows[i + 1].point, leg.to]])
        .filter(visible)
        .map(([point, end]) => line(point, end));
}

function fitPadding() {
    const panel = document.querySelector(".panel").getBoundingClientRect();
    if (innerWidth <= 640) return { top: 60, right: 40, left: 40, bottom: panel.height + 40 };
    return { top: 60, right: 60, bottom: 60, left: panel.right + 40 };
}

// #region place search
function setupSearch(row) {
    const { input, list } = row;
    let timer = null;
    let searchSequence = 0;
    let fullText = null; // text of the last full search
    let active = -1; // option picked with the arrow keys

    list.id = `suggestions-${++listCount}`;
    list.setAttribute("role", "listbox");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");

    const options = () => [...list.querySelectorAll("button")];

    function highlight(index) {
        const items = options();
        active = items.length > 0 ? (index + items.length) % items.length : -1;
        items.forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
        if (active < 0) return input.removeAttribute("aria-activedescendant");
        input.setAttribute("aria-activedescendant", items[active].id);
        items[active].scrollIntoView({ block: "nearest" });
    }

    function show() {
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        highlight(-1);
    }

    function hide() {
        list.hidden = true;
        input.setAttribute("aria-expanded", "false");
        active = -1;
        input.removeAttribute("aria-activedescendant");
    }

    function listButton(text, onClick, className = "") {
        const li = document.createElement("li");
        li.setAttribute("role", "presentation");
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = text;
        // focus stays in the input, the arrow keys move between options
        button.tabIndex = -1;
        button.id = `${list.id}-${list.children.length}`;
        button.setAttribute("role", "option");
        // mousedown runs before blur hides the list
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", onClick);
        li.append(button);
        return li;
    }

    function render(items, full) {
        list.replaceChildren();
        if (items.length === 0) {
            const empty = document.createElement("li");
            empty.setAttribute("role", "presentation");
            empty.className = "empty";
            empty.textContent = t("plan.noResults");
            list.append(empty);
        }
        for (const item of items) {
            list.append(listButton(item.label, () => {
                hide();
                setPoint(row, item, { fly: true });
            }, "result"));
        }
        // stadia misses small villages
        if (!full) list.append(listButton(t("plan.searchAll"), searchAll, "search-all"));
        show();
    }

    function renderMessage(text) {
        list.replaceChildren();
        const li = document.createElement("li");
        li.setAttribute("role", "presentation");
        li.className = "empty";
        li.textContent = text;
        list.append(li);
        show();
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

    function useCoordinates() {
        const text = input.value.trim();
        if (outOfRange(text)) showStatus(t("plan.coordinatesOutOfRange"), true);
        const coordinates = parseCoordinates(text);
        if (!coordinates) return false;
        hide();
        // unchanged text, keep the point
        if (text !== pointText(row.point)) setPoint(row, coordinates, { fly: true });
        return true;
    }

    input.addEventListener("focus", () => (activeRow = row));
    input.addEventListener("blur", () => {
        hide();
        if (!useCoordinates()) input.value = pointText(row.point);
    });
    input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hide();
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !list.hidden) {
            event.preventDefault();
            highlight(active + (event.key === "ArrowDown" ? 1 : -1));
            return;
        }
        if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            options()[active].click();
            return;
        }
        if (event.key !== "Enter" || useCoordinates()) return;
        // first enter searches all places, second picks the first result
        if (fullText === input.value.trim() && !list.hidden) list.querySelector("button.result")?.click();
        else searchAll();
    });
    input.addEventListener("input", () => {
        clearTimeout(timer);
        fullText = null;
        const text = input.value.trim();
        if (text.length < SEARCH_MIN_CHARS) return hide();
        if (outOfRange(text)) return renderMessage(t("plan.coordinatesOutOfRange"));
        const coordinates = parseCoordinates(text);
        if (coordinates) return render([{ ...coordinates, label: formatCoordinates(coordinates) }], true);
        timer = setTimeout(() => search(text, false), SEARCH_DEBOUNCE_MS);
    });
}
// #endregion

// #region rows
function createRow(element) {
    const row = { element, input: element.querySelector("input"), list: element.querySelector(".suggestions"), point: null, marker: null };
    setupSearch(row);
    return row;
}

function addStop() {
    if (rows.length - 2 >= MAX_STOPS) return;
    const element = stopTemplate.content.firstElementChild.cloneNode(true);
    applyTranslations(element);
    const input = element.querySelector("input");
    input.id = `stop-input-${++stopCount}`;
    element.querySelector("label").htmlFor = input.id;
    const row = createRow(element);
    element.querySelector(".remove").addEventListener("click", () => removeStop(row));
    pointList.insertBefore(element, rows[rows.length - 1].element);
    rows.splice(rows.length - 1, 0, row);
    renumberStops();
    updateAddStop();
    activeRow = row;
    row.input.focus();
    routeChanged();
}

function updateAddStop() {
    const button = document.getElementById("add-stop");
    button.disabled = rows.length - 2 >= MAX_STOPS;
    button.title = button.disabled ? t("plan.maxStops", MAX_STOPS) : "";
}

function removeStop(row) {
    removeMarker(row);
    row.element.remove();
    rows.splice(rows.indexOf(row), 1);
    renumberStops();
    updateAddStop();
    if (activeRow === row) activeRow = firstEmptyRow() ?? rows[rows.length - 1];
    routeChanged();
}

const firstEmptyRow = () => rows.find((row) => !row.point) ?? null;

for (const element of pointList.querySelectorAll(".point")) rows.push(createRow(element));
activeRow = rows[0];
// #endregion

map.on("click", (event) => {
    const row = activeRow;
    setPoint(row, { lat: event.lngLat.lat, lng: event.lngLat.lng, label: null });
    activeRow = firstEmptyRow() ?? row;
});

document.getElementById("add-stop").addEventListener("click", addStop);

document.getElementById("reverse").addEventListener("click", () => {
    const reversed = rows.map((row) => row.point).reverse();
    rows.forEach((row, i) => {
        removeMarker(row);
        row.point = reversed[i];
        row.input.value = pointText(row.point);
        drawMarker(row);
    });
    routeChanged();
});

async function loadVehicles() {
    const select = document.getElementById("vehicle");
    const vehicles = (await api("GET", "/vehicle")).filter((vehicle) => vehicle.plannable);
    select.replaceChildren(...vehicles.map((vehicle) => new Option(t(`vehicle.${vehicle.id}`), vehicle.id)));
    updateFilterGroups();
}

planButton.addEventListener("click", plan);
document.querySelectorAll("input[name=policy], #vehicle").forEach((el) => el.addEventListener("change", updateFilterGroups));
document.querySelectorAll("input[name=policy], .filters input, #vehicle").forEach((el) => el.addEventListener("change", routeChanged));
document.querySelector("input[name=maxDetour]").addEventListener("input", showMaxDetour);
updateFilterGroups();
showMaxDetour();
loadVehicles().catch((err) => showStatus(err.message, true));

saveButton.addEventListener("click", async () => {
    if (!currentRoute) return;
    const defaultName = rows.map((row) => pointText(row.point)).join(" → ").slice(0, MAX_NAME_LENGTH);
    const name = prompt(t("plan.savePrompt"), defaultName)?.trim();
    if (!name) return;
    saveButton.disabled = true;
    let trackId = null;
    try {
        trackId = (await api("POST", "/track", { name, vehicle: currentRoute.vehicle })).id;
        const form = new FormData();
        // legs are only for this page, the file keeps the app format
        const { track, distance, duration } = currentRoute;
        form.append("file", new Blob([JSON.stringify({ track, distance, duration })], { type: "application/json" }), "track.json");
        await api("POST", `/track/file?id=${trackId}`, form);
        showStatus(t("plan.saved"));
    } catch (err) {
        // no track without its file
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

navigator.geolocation?.getCurrentPosition(
    (position) => {
        showMyLocation(position);
        if (rows[0].point) return;
        const here = { lat: position.coords.latitude, lng: position.coords.longitude, label: t("plan.myLocation") };
        map.jumpTo({ center: [here.lng, here.lat], zoom: 14 });
        setPoint(rows[0], here);
        if (activeRow === rows[0]) activeRow = firstEmptyRow() ?? rows[0];
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10_000 },
);
