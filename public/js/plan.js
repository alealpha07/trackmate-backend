import { api, apiStream, applyTranslations, t } from "./common.js";

applyTranslations();

try {
    await api("GET", "/auth/user");
} catch (err) {
    if (err.status !== 401) throw err;
    location.replace("/login");
    await new Promise(() => {}); // page is redirecting
}

const DEFAULT_CENTER = [10.3279, 44.8015]; // Parma
const DEFAULT_ZOOM = 13;
const SEARCH_MIN_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 300;
// same limit as the server
const MAX_LEG_METERS = 50_000;
const EARTH_RADIUS_METERS = 6_371_008.8;

// no api key needed, stadia uses domain auth
const ATTRIBUTION = '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> '
    + '&copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> '
    + '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const DEM_ATTRIBUTION = "Elevation data produced using Copernicus WorldDEM-30 &copy; DLR e.V. 2010-2014 and &copy; Airbus Defence and Space GmbH 2014-2018 "
    + "provided under COPERNICUS by the European Union and ESA; all rights reserved";
const MAP_STYLES = [
    { id: "outdoors", label: "plan.styleOutdoors" },
    { id: "osm_bright", label: "plan.styleStreets" },
    { id: "alidade_smooth", label: "plan.styleLight" },
    { id: "alidade_smooth_dark", label: "plan.styleDark" },
];
const MAP_STYLE_KEY = "trackmate.mapStyle";
// same icons as the app
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

function tileUrls(style) {
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
            basemap: { type: "raster", tiles: tileUrls(savedMapStyle()), tileSize: 256, maxzoom: 20, attribution: ATTRIBUTION },
            // required by the copernicus licence
            route: { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: DEM_ATTRIBUTION },
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

class LayersControl {
    onAdd() {
        const container = document.createElement("div");
        container.className = "maplibregl-ctrl maplibregl-ctrl-group layers";

        const button = document.createElement("button");
        button.type = "button";
        button.title = t("plan.mapStyle");
        button.setAttribute("aria-label", t("plan.mapStyle"));
        button.setAttribute("aria-expanded", "false");
        button.innerHTML = LAYERS_ICON;

        const menu = document.createElement("div");
        menu.className = "layers-menu card";
        menu.setAttribute("role", "radiogroup");
        menu.setAttribute("aria-label", t("plan.mapStyle"));
        menu.hidden = true;
        const title = document.createElement("p");
        title.textContent = t("plan.mapStyle");
        menu.append(title);
        const current = savedMapStyle();
        for (const style of MAP_STYLES) {
            const label = document.createElement("label");
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "map-style";
            radio.value = style.id;
            radio.checked = style.id === current;
            radio.addEventListener("change", () => {
                map.getSource("basemap").setTiles(tileUrls(style.id));
                try {
                    localStorage.setItem(MAP_STYLE_KEY, style.id);
                } catch {}
                toggle(false);
            });
            label.append(radio, t(style.label));
            menu.append(label);
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
            if (event.key === "Escape") toggle(false);
        });

        container.append(button, menu);
        return container;
    }

    onRemove() {}
}
map.addControl(new LayersControl(), "top-right");

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

// #region state
const rows = [];
let activeRow = null; // the row a map tap fills
let currentRoute = null;
let planSequence = 0; // ignore responses of outdated requests
let planController = null; // to cancel the previous plan request

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

// accepts "44.8, 10.3", "44.8 10.3" and "44,8; 10,3"
function parseCoordinates(text) {
    const match = text.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)
        ?? text.match(/^(-?\d+(?:,\d+)?)\s*[;\s]\s*(-?\d+(?:,\d+)?)$/);
    if (!match) return null;
    const [lat, lng] = [match[1], match[2]].map((value) => Number(value.replace(",", ".")));
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng, label: null };
}

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
            const km = new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(meters / 1000);
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
    const km = new Intl.NumberFormat("en", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(meters / 1000);
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

function selectedOptions() {
    const filters = {};
    document.querySelectorAll(".filters:not([hidden]) input").forEach((input) => (filters[input.name] = input.checked));
    return {
        vehicle: document.getElementById("vehicle").value,
        policy: document.querySelector("input[name=policy]:checked").value,
        filters,
    };
}

async function plan() {
    if (rows.some((row) => !row.point) || routeProblem()) return;
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
        if (sequence === planSequence) setPlanning(false);
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

    const hide = () => (list.hidden = true);

    function listButton(text, onClick, className = "") {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = text;
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

    function useCoordinates() {
        const text = input.value.trim();
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
    const element = stopTemplate.content.firstElementChild.cloneNode(true);
    applyTranslations(element);
    const row = createRow(element);
    element.querySelector(".remove").addEventListener("click", () => removeStop(row));
    pointList.insertBefore(element, rows[rows.length - 1].element);
    rows.splice(rows.length - 1, 0, row);
    renumberStops();
    activeRow = row;
    row.input.focus();
    routeChanged();
}

function removeStop(row) {
    removeMarker(row);
    row.element.remove();
    rows.splice(rows.indexOf(row), 1);
    renumberStops();
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
updateFilterGroups();
loadVehicles().catch((err) => showStatus(err.message, true));

saveButton.addEventListener("click", async () => {
    if (!currentRoute) return;
    const defaultName = rows.map((row) => pointText(row.point)).join(" → ");
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
