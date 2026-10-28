import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import dotenv from "dotenv";
import { chromium, Page } from "@playwright/test";
import {
    BENCHMARK_DIR, CITIES, CITY_COLORS, DETOUR_BANDS, FILTER_COLORS, FILTER_CONFIGS, GROUP_COLORS, GROUPS, HAZARDS, LANGUAGE,
    MAX_DETOUR_RATIO, PLANNER_VARIANTS, STADIA_STYLE, TAG_CHECKS, VARIANT_COLORS, VARIANTS, VariantId,
} from "./config.js";
import { Metrics, Row, Showcase } from "./analyze.js";
import { outPath, readJson } from "./io.js";
import { CityRoutes } from "./routes.js";
import { num, S } from "./strings.js";

const ROOT = path.join(BENCHMARK_DIR, "..");
const MODULES = path.join(ROOT, "node_modules");
const FILES: Record<string, string> = {
    "/chart.js": path.join(MODULES, "chart.js", "dist", "chart.umd.min.js"),
    "/boxplot.js": path.join(MODULES, "@sgratzl", "chartjs-chart-boxplot", "build", "index.umd.min.js"),
};
const TYPES: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html" };
const SCALE = 3;
const MAP_SCALE = 2;

const CHART_PAGE = `<!doctype html><html lang="${LANGUAGE}"><head><meta charset="utf-8">
<style>html, body { margin: 0; background: #fff; } #wrap { position: relative; }</style>
<script src="/chart.js"></script><script src="/boxplot.js"></script>
<script>
if (!Chart.registry.controllers.get("boxplot")) Chart.register(ChartBoxPlot.BoxPlotController, ChartBoxPlot.BoxAndWiskers);
Chart.defaults.font.family = "Arial, Helvetica, sans-serif";
Chart.defaults.font.size = 14;
Chart.defaults.color = "#222";
Chart.defaults.animation = false;
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;
window.draw = (config, percentAxes, width, height) => {
    const wrap = document.getElementById("wrap");
    wrap.style.width = width + "px";
    wrap.style.height = height + "px";
    for (const axis of percentAxes) {
        const scale = config.options.scales[axis];
        scale.ticks = { ...(scale.ticks || {}), callback: (v) => v + "%" };
    }
    new Chart(document.getElementById("chart"), config);
};
</script></head><body><div id="wrap"><canvas id="chart"></canvas></div></body></html>`;

const MAP_PAGE = `<!doctype html><html lang="${LANGUAGE}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/maplibre/maplibre-gl.css">
<style>
html, body, #map { margin: 0; width: 100%; height: 100%; }
.legend { position: absolute; top: 14px; left: 14px; z-index: 2; background: rgba(255,255,255,.93); padding: 10px 14px;
    font: 15px Arial, sans-serif; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.35); line-height: 1.5; }
.legend b { display: block; margin-bottom: 4px; }
.legend span.swatch { display: inline-block; width: 26px; height: 5px; margin: 0 8px 3px 0; vertical-align: middle; border-radius: 2px; }
.end { width: 26px; height: 26px; border-radius: 50%; background: #222; color: #fff; font: bold 14px Arial, sans-serif;
    display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.5); }
#inset { position: absolute; width: 440px; height: 330px; z-index: 2; display: none;
    border: 3px solid #222; box-shadow: 0 1px 6px rgba(0,0,0,.45); }
</style></head><body><div id="map"></div><div class="legend" id="legend"></div><div id="inset"></div>
<script type="module">
import * as maplibregl from "/maplibre/maplibre-gl.mjs";
const style = (spec) => ({
    version: 8,
    sources: { basemap: { type: "raster", tiles: [spec.tiles], tileSize: 256, maxzoom: 20, attribution: spec.attribution } },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
});
const line = (coords) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });
// wider routes below, so routes on the same road show as nested stripes
function drawRoutes(map, spec) {
    const layout = { "line-cap": "round", "line-join": "round" };
    for (const r of spec.routes) map.addSource(r.id, { type: "geojson", data: line(r.coords) });
    for (const r of spec.routes) map.addLayer({ id: r.id + "-casing", type: "line", source: r.id, layout, paint: { "line-color": "#fff", "line-width": r.width + 3 } });
    for (const r of spec.routes) map.addLayer({ id: r.id, type: "line", source: r.id, layout, paint: { "line-color": r.color, "line-width": r.width } });
    for (const [label, at] of [["A", spec.from], ["B", spec.to]]) {
        const el = Object.assign(document.createElement("div"), { className: "end", textContent: label });
        new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map);
    }
}
const ready = (map) => new Promise((resolve) => {
    map.once("idle", resolve);
    setTimeout(resolve, 45000);
});
const loaded = (map) => new Promise((resolve) => map.on("load", resolve));
const INSET = { width: 440, height: 330, gap: 14, bottom: 34 };
// screen points along every route and frame line, a few pixels apart
function drawnPoints(map, lines) {
    const points = [];
    for (const coords of lines) {
        const px = coords.map((c) => map.project(c));
        px.forEach((p, i) => {
            const q = px[i + 1] ?? p;
            const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 5));
            for (let k = 0; k < steps; k++) points.push({ x: p.x + ((q.x - p.x) * k) / steps, y: p.y + ((q.y - p.y) * k) / steps });
        });
    }
    return points;
}
// the legend is top left, so the inset goes in the corner with the fewest routes under it
function insetCorner(map, lines) {
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const corners = [
        { side: "right", left: w - INSET.gap - INSET.width, top: h - INSET.bottom - INSET.height },
        { side: "right", left: w - INSET.gap - INSET.width, top: INSET.gap },
        { side: "left", left: INSET.gap, top: h - INSET.bottom - INSET.height },
    ];
    const points = drawnPoints(map, lines);
    const margin = 16;
    for (const c of corners) {
        c.hits = points.filter((p) => p.x > c.left - margin && p.x < c.left + INSET.width + margin
            && p.y > c.top - margin && p.y < c.top + INSET.height + margin).length;
    }
    return corners.reduce((a, b) => (b.hits < a.hits ? b : a));
}
window.render = async (spec) => {
    document.getElementById("legend").innerHTML = spec.legend;
    const padding = { top: 50, bottom: 50, left: 360, right: 50 };
    const map = new maplibregl.Map({
        container: "map",
        style: style(spec),
        bounds: spec.bounds,
        fitBoundsOptions: { padding },
        attributionControl: { compact: false },
        fadeDuration: 0,
        canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    await loaded(map);
    drawRoutes(map, spec);
    const waits = [];
    if (spec.inset) {
        const [[w, s], [e, n]] = spec.inset;
        const frame = [[w, s], [e, s], [e, n], [w, n], [w, s]];
        map.addSource("inset-frame", { type: "geojson", data: line(frame) });
        map.addLayer({ id: "inset-frame", type: "line", source: "inset-frame", paint: { "line-color": "#222", "line-width": 2, "line-dasharray": [3, 2] } });
        const lines = [...spec.routes.map((r) => r.coords), frame, [spec.from], [spec.to]];
        let corner = insetCorner(map, lines);
        if (corner.hits > 0) {
            // no free corner: keep that side of the map clear
            map.fitBounds(spec.bounds, { padding: { ...padding, [corner.side]: INSET.width + 2 * INSET.gap + 20 }, animate: false });
            corner = insetCorner(map, lines);
        }
        const box = document.getElementById("inset");
        Object.assign(box.style, { left: corner.left + "px", top: corner.top + "px", right: "auto", bottom: "auto" });
        box.style.display = "block";
        const inset = new maplibregl.Map({
            container: box, style: style(spec), bounds: spec.inset, attributionControl: false, fadeDuration: 0,
            canvasContextAttributes: { preserveDrawingBuffer: true },
        });
        await loaded(inset);
        drawRoutes(inset, spec);
        waits.push(ready(inset));
    }
    waits.push(ready(map));
    await Promise.all(waits);
};
window.ready = true;
</script></body></html>`;

function serve(): Promise<http.Server> {
    const server = http.createServer((req, res) => {
        const url = (req.url ?? "/").split("?")[0];
        let file: string | undefined = FILES[url];
        let body: string | undefined;
        if (url === "/chart.html") body = CHART_PAGE;
        else if (url === "/map.html") body = MAP_PAGE;
        else if (url.startsWith("/maplibre/")) file = path.join(MODULES, "maplibre-gl", "dist", path.basename(url));
        if (body === undefined && (!file || !fs.existsSync(file))) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file ?? url)] ?? "application/octet-stream" });
        res.end(body ?? fs.readFileSync(file!));
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const pct = (x: number) => +(100 * x).toFixed(2);
const COMPARED: VariantId[] = ["safest", "safest_filters", "valhalla"];

function chartConfigs(m: Metrics) {
    const valid = (id: VariantId) => m.rows.filter((r) => r.variant === id && r.valid);
    const cityLabels = CITIES.map((c) => S.cities[c.id]);
    const groupedByCity = (value: (id: VariantId, city: string | null) => number, ids: VariantId[] = VARIANTS) => ({
        labels: [...cityLabels, S.allCities],
        datasets: ids.map((id) => ({
            label: S.variants[id],
            backgroundColor: VARIANT_COLORS[id],
            data: [...CITIES.map((c) => value(id, c.id)), value(id, null)],
        })),
    });
    const stats = (city: string | null) => (city ? m.cities[city] : m.all);
    const stackedShares = (bars: { label: string | string[]; groups: Record<string, number>; total: number }[]) => ({
        labels: bars.map((b) => b.label),
        datasets: GROUPS.map((g) => ({
            label: S.groups[g],
            backgroundColor: GROUP_COLORS[g],
            data: bars.map((b) => (b.total > 0 ? pct(b.groups[g] / b.total) : 0)),
        })),
    });
    const legendBottom = { legend: { position: "bottom" } };
    const thresholdLine = (x: number, label: string, dash: number[]) => ({
        type: "line", label, data: [{ x, y: 0 }, { x, y: 100 }], borderColor: "#666", borderDash: dash, borderWidth: 1.5,
        pointRadius: 0, showLine: true, fill: false,
    });
    const cdf = (id: VariantId) => {
        const detours = valid(id).map((r) => 100 * r.detour).sort((a, b) => a - b);
        const steps = detours.map((d, i) => ({ x: +d.toFixed(2), y: +((100 * (i + 1)) / detours.length).toFixed(2) }));
        return steps.length > 0 ? [{ x: steps[0].x, y: 0 }, ...steps] : steps;
    };
    const maxDetour = Math.max(...COMPARED.flatMap((id) => valid(id).map((r) => 100 * r.detour)));
    const detourAxisMax = Math.max(60, Math.ceil(maxDetour / 10) * 10);
    const scatter = (id: VariantId, x: (r: Row) => number, y: (r: Row) => number) => ({
        label: S.variants[id], backgroundColor: VARIANT_COLORS[id] + "b0", borderColor: VARIANT_COLORS[id], pointRadius: 4,
        data: valid(id).map((r) => ({ x: +x(r).toFixed(3), y: +y(r).toFixed(3) })),
    });

    return [
        {
            name: "fig_network_composition", width: 1000, height: 620, percent: ["x"],
            config: {
                type: "bar",
                data: stackedShares(CITIES.flatMap((c) => [
                    { label: `${S.cities[c.id]}, ${S.chart.network}`, groups: m.network[c.id].groups, total: m.network[c.id].distance },
                    { label: `${S.cities[c.id]}, ${S.chart.travelled}`, groups: m.travelled[c.id].groups, total: m.travelled[c.id].distance },
                ])),
                options: {
                    indexAxis: "y",
                    scales: { x: { stacked: true, max: 100, title: { display: true, text: S.chart.lengthShare } }, y: { stacked: true } },
                    plugins: legendBottom,
                },
            },
        },
        {
            name: "fig_osm_tags", width: 1000, height: 640, percent: ["x"],
            config: {
                type: "bar",
                data: {
                    labels: TAG_CHECKS.map((id) => S.tags[id]),
                    datasets: CITIES.map((c) => ({
                        label: S.cities[c.id],
                        backgroundColor: CITY_COLORS[c.id],
                        data: TAG_CHECKS.map((id) => {
                            const check = m.tags[c.id].checks[id];
                            return check.total > 0 ? pct(check.tagged / check.total) : 0;
                        }),
                    })),
                },
                options: {
                    indexAxis: "y",
                    scales: { x: { min: 0, max: 100, title: { display: true, text: S.chart.tagShare } } },
                    plugins: legendBottom,
                },
            },
        },
        {
            name: "fig_route_composition", width: 1000, height: 1500, percent: ["x"],
            config: {
                type: "bar",
                data: stackedShares([...CITIES.map((c) => c.id), null].flatMap((city) => VARIANTS.map((id) => ({
                    label: [city ? S.cities[city] : S.allCities, S.variants[id]].join(", "),
                    groups: stats(city)[id].groups,
                    total: 1,
                })))),
                options: {
                    indexAxis: "y",
                    scales: { x: { stacked: true, max: 100, title: { display: true, text: S.chart.travelledShare } }, y: { stacked: true } },
                    plugins: legendBottom,
                },
            },
        },
        {
            name: "fig_risk_reduction", width: 1000, height: 560, percent: ["y"],
            config: {
                type: "boxplot",
                data: {
                    labels: [...cityLabels, S.allCities],
                    datasets: COMPARED.map((id) => ({
                        label: S.variants[id],
                        backgroundColor: VARIANT_COLORS[id] + "66",
                        borderColor: VARIANT_COLORS[id],
                        borderWidth: 1.5,
                        outlierBackgroundColor: VARIANT_COLORS[id],
                        itemRadius: 0,
                        data: [...CITIES.map((c) => valid(id).filter((r) => r.city === c.id).map((r) => pct(r.reduction))), valid(id).map((r) => pct(r.reduction))],
                    })),
                },
                options: {
                    scales: { y: { title: { display: true, text: S.chart.reduction } } },
                    plugins: legendBottom,
                },
            },
        },
        {
            name: "fig_detour_cdf", width: 1000, height: 560, percent: ["x", "y"],
            config: {
                type: "scatter",
                data: {
                    datasets: [
                        ...COMPARED.map((id) => ({
                            label: S.variants[id], data: cdf(id), borderColor: VARIANT_COLORS[id], backgroundColor: VARIANT_COLORS[id],
                            showLine: true, stepped: true, pointRadius: 0, borderWidth: 2.5,
                        })),
                        thresholdLine(100 * (MAX_DETOUR_RATIO - 1), S.chart.threshold(Math.round(100 * (MAX_DETOUR_RATIO - 1))), [8, 4]),
                        ...DETOUR_BANDS.map((b) => thresholdLine(100 * b, S.chart.band(Math.round(100 * b)), [2, 3])),
                    ],
                },
                options: {
                    scales: {
                        x: { min: 0, max: detourAxisMax, title: { display: true, text: S.chart.detour } },
                        y: { min: 0, max: 100, title: { display: true, text: S.chart.cumulative } },
                    },
                    plugins: legendBottom,
                },
            },
        },
        {
            name: "fig_lts4", width: 1000, height: 520, percent: ["y"],
            config: {
                type: "bar",
                data: groupedByCity((id, city) => pct(stats(city)[id].lts4Share)),
                options: { scales: { y: { beginAtZero: true, title: { display: true, text: S.chart.lts4 } } }, plugins: legendBottom },
            },
        },
        {
            name: "fig_hazards", width: 1000, height: 640, percent: [],
            config: {
                type: "bar",
                data: {
                    labels: HAZARDS.map((h) => S.hazards[h]),
                    datasets: VARIANTS.map((id) => ({
                        label: S.variants[id], backgroundColor: VARIANT_COLORS[id], data: HAZARDS.map((h) => +m.all[id].hazards[h].toFixed(2)),
                    })),
                },
                options: { indexAxis: "y", scales: { x: { beginAtZero: true, title: { display: true, text: S.chart.exposure } } }, plugins: legendBottom },
            },
        },
        {
            name: "fig_risk_vs_detour", width: 1000, height: 620, percent: ["x", "y"],
            config: {
                type: "scatter",
                data: { datasets: COMPARED.map((id) => scatter(id, (r) => 100 * r.detour, (r) => 100 * r.reduction)) },
                options: {
                    scales: {
                        x: { title: { display: true, text: S.chart.detour } },
                        y: { title: { display: true, text: S.chart.reduction } },
                    },
                    plugins: legendBottom,
                },
            },
        },
        {
            name: "fig_filters", width: 1000, height: 560, percent: ["y"],
            config: {
                type: "bar",
                data: {
                    labels: [...cityLabels, S.allCities],
                    datasets: FILTER_CONFIGS.map((id) => ({
                        label: S.filterConfigs[id],
                        backgroundColor: FILTER_COLORS[id],
                        data: [...CITIES.map((c) => pct(m.filters[c.id][id].reduction)), pct(m.filters.all[id].reduction)],
                    })),
                },
                options: { scales: { y: { title: { display: true, text: S.chart.medianReduction } } }, plugins: legendBottom },
            },
        },
        {
            name: "fig_timing", width: 1000, height: 560, percent: [],
            config: {
                type: "scatter",
                data: {
                    datasets: PLANNER_VARIANTS.map((v) => scatter(v.id, (r) => r.straight / 1000, (r) => r.planMs!)),
                },
                options: {
                    scales: {
                        x: { title: { display: true, text: S.chart.straight } },
                        y: { beginAtZero: true, title: { display: true, text: S.chart.planTime } },
                    },
                    plugins: legendBottom,
                },
            },
        },
        {
            name: "fig_safest_variant", width: 1000, height: 520, percent: [],
            config: {
                type: "bar",
                data: groupedByCity((id, city) => stats(city)[id].wins),
                options: {
                    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: S.chart.wins } } },
                    plugins: legendBottom,
                },
            },
        },
    ];
}

async function drawChart(page: Page, base: string, chart: ReturnType<typeof chartConfigs>[number], dir: string) {
    await page.setViewportSize({ width: chart.width, height: chart.height });
    await page.goto(`${base}/chart.html`);
    await page.evaluate(({ config, percent, width, height }) => (window as any).draw(config, percent, width, height),
        { config: chart.config, percent: chart.percent, width: chart.width, height: chart.height });
    await page.locator("#wrap").screenshot({ path: path.join(dir, `${chart.name}.png`) });
}

function stadiaKey(): string {
    const env = path.join(ROOT, ".env");
    const key = process.env.STADIA_API_KEY || (fs.existsSync(env) ? dotenv.parse(fs.readFileSync(env)).STADIA_API_KEY : "");
    if (!key) throw new Error("STADIA_API_KEY is not set in .env, the maps need it");
    return key;
}

// drawn bottom to top
const MAP_ORDER: VariantId[] = ["valhalla", "shortest", "safest_filters", "safest"];
const WIDTHS: Record<VariantId, number> = { valhalla: 11, shortest: 8, safest_filters: 5.5, safest: 3 };
// safest farther than this from shortest shows on the whole map, no inset needed
const MAX_PARALLEL_GAP_METERS = 150;
// beside shortest but not on it: a side path, the other carriageway
const PARALLEL_GAP_METERS = [4, 60];
const MIN_PARALLEL_METERS = 150;
const INSET_HALF_WIDTH_METERS = 220;

type LngLat = [number, number];

// the longest stretch where safest runs beside shortest, too close to tell apart on the whole map
function parallelStretch(safest: LngLat[], shortest: LngLat[]): [LngLat, LngLat] | null {
    const kx = 111_320 * Math.cos((safest[0][1] * Math.PI) / 180);
    const ky = 110_540;
    const xy = (p: LngLat) => [p[0] * kx, p[1] * ky];
    const line = shortest.map(xy);
    const gap = (p: number[]) => Math.min(...line.slice(1).map((b, i) => {
        const a = line[i];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    }));
    const points = safest.map(xy);
    const gaps = points.map(gap);
    if (Math.max(...gaps) > MAX_PARALLEL_GAP_METERS) return null;

    let best: [number, number] | null = null;
    let bestLength = 0;
    let start = -1;
    let length = 0;
    for (let i = 0; i < points.length; i++) {
        const beside = gaps[i] >= PARALLEL_GAP_METERS[0] && gaps[i] <= PARALLEL_GAP_METERS[1];
        if (!beside) {
            start = -1;
            continue;
        }
        if (start < 0) {
            start = i;
            length = 0;
        } else {
            length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        }
        if (length > bestLength) {
            bestLength = length;
            best = [start, i];
        }
    }
    if (!best || bestLength < MIN_PARALLEL_METERS) return null;
    const middle = safest[Math.round((best[0] + best[1]) / 2)];
    const dx = INSET_HALF_WIDTH_METERS / kx;
    const dy = (INSET_HALF_WIDTH_METERS * 0.75) / ky;
    return [[middle[0] - dx, middle[1] - dy], [middle[0] + dx, middle[1] + dy]];
}

async function drawMap(page: Page, base: string, key: string, routes: Record<string, CityRoutes>, metrics: Metrics, show: Showcase, index: number, dir: string) {
    const city = CITIES.find((c) => c.id === show.city)!;
    const result = routes[city.id].pairs.find((p) => p.pair.id === show.pair)!;
    const rows = metrics.rows.filter((r) => r.city === city.id && r.pair === show.pair);
    const drawn = MAP_ORDER.filter((id) => result.variants[id]?.ok && result.variants[id]!.geometry);
    const coords = drawn.flatMap((id) => result.variants[id]!.geometry!);
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const legend = `<b>${S.map.title(S.cities[city.id], show.pair, S.roles[show.role])}</b>` + [...drawn].reverse().map((id) => {
            const r = rows.find((x) => x.variant === id)!;
            const extra = id === "shortest" ? "" : `, ${S.map.risk} ${r.reduction >= 0 ? "-" : "+"}${num(Math.abs(100 * r.reduction))}%`;
            return `<span class="swatch" style="background:${VARIANT_COLORS[id]}"></span>${S.variants[id]}: ${num(r.distance / 1000, 2)} km${extra}`;
        }).join("<br>");

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(`${base}/map.html`);
    await page.waitForFunction(() => (window as any).ready === true);
    await page.evaluate((spec) => (window as any).render(spec), {
        tiles: `https://tiles.stadiamaps.com/tiles/${STADIA_STYLE}/{z}/{x}/{y}@2x.png?api_key=${key}`,
        attribution: "&copy; Stadia Maps &copy; OpenMapTiles &copy; OpenStreetMap contributors",
        bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        routes: drawn.map((id) => ({ id, coords: result.variants[id]!.geometry, color: VARIANT_COLORS[id], width: WIDTHS[id] })),
        inset: result.variants.safest?.ok && result.variants.shortest?.ok
            ? parallelStretch(result.variants.safest.geometry!, result.variants.shortest.geometry!)
            : null,
        from: [result.pair.from.lng, result.pair.from.lat],
        to: [result.pair.to.lng, result.pair.to.lat],
        legend,
    });
    const name = `map_${city.id}_${index + 1}_${show.role}_${show.pair}.png`;
    await page.screenshot({ path: path.join(dir, name) });
}

export async function runFigures() {
    const metrics = readJson<Metrics>(outPath("metrics.json"));
    const routes = Object.fromEntries(CITIES.map((c) => [c.id, readJson<CityRoutes>(outPath("routes", `${c.id}.json`))]));
    const dir = outPath("figures");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const server = await serve();
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const browser = await chromium.launch();
    try {
        const charts = await browser.newPage({ deviceScaleFactor: SCALE });
        charts.on("pageerror", (error) => console.error(`chart page: ${error.message}`));
        for (const chart of chartConfigs(metrics)) {
            await drawChart(charts, base, chart, dir);
            console.log(`  ${chart.name}.png`);
        }

        const key = stadiaKey();
        const maps = await browser.newPage({ deviceScaleFactor: MAP_SCALE });
        maps.on("pageerror", (error) => console.error(`map page: ${error.message}`));
        for (const city of CITIES) {
            const shows = metrics.showcase.filter((s) => s.city === city.id);
            for (const [i, show] of shows.entries()) await drawMap(maps, base, key, routes, metrics, show, i, dir);
            console.log(`  ${S.cities[city.id]}: ${shows.length} maps`);
        }
    } finally {
        await browser.close();
        server.close();
    }
}
