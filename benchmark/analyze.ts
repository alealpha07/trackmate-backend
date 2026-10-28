import fs from "fs";
import {
    CITIES, City, DETOUR_BANDS, FILTER_CONFIGS, FilterConfigId, GROUPS, GroupId, HAZARDS, HazardId, MAX_DETOUR_METERS,
    MAX_DETOUR_RATIO, MIN_COVERAGE, PLANNER_VARIANTS, ROUTE_TYPES, TAG_CHECKS, VARIANTS, VariantId,
} from "./config.js";
import { SNAPSHOT_FILE, Snapshot } from "./data.js";
import { FilterRun, PairFilterRuns } from "./filters.js";
import { outPath, readJson, writeJson, writeText } from "./io.js";
import { CityRoutes, PairResult, VariantResult } from "./routes.js";
import { Score } from "./score.js";
import { num, S } from "./strings.js";
import { TagStats } from "./tags.js";
import { VALHALLA_STATUS_FILE } from "./valhalla.js";

export interface Row {
    city: string;
    pair: number;
    variant: VariantId;
    ok: boolean;
    // valhalla matched well enough to compare its risk
    valid: boolean;
    distance: number;
    risk: number;
    meanOr: number;
    detour: number;
    reduction: number;
    reductionVsValhalla: number | null;
    lts4Share: number;
    bikewayShare: number;
    coverage: number | null;
    acceptable: boolean;
    planMs: number | null;
    planP95: number | null;
    firstMs: number | null;
    graphMs: number;
    safest: boolean;
    groups: Record<GroupId, number>;
    // per km, crossings per 10 km
    hazards: Record<HazardId, number>;
    straight: number;
}

export interface VariantStats {
    n: number;
    reduction: { median: number; q1: number; q3: number } | null;
    reductionVsValhalla: number | null;
    detour: number | null;
    lts4Share: number;
    bikewayShare: number;
    acceptable: number | null;
    bands: number[] | null;
    wins: number;
    groups: Record<GroupId, number>;
    hazards: Record<HazardId, number>;
    planMs: number | null;
    planP95: number | null;
}

export interface Showcase {
    city: string;
    pair: number;
    role: "best" | "median" | "worst";
    score: number;
}

export interface FilterStats {
    n: number;
    reduction: number;
    detour: number;
    // routes riskier than shortest
    riskier: number;
    lts4Share: number;
    bikewayShare: number;
}

export interface Metrics {
    rows: Row[];
    cities: Record<string, Record<VariantId, VariantStats>>;
    countries: Record<string, Record<VariantId, VariantStats>>;
    all: Record<VariantId, VariantStats>;
    network: Record<string, Score>;
    travelled: Record<string, Score>;
    showcase: Showcase[];
    graphMs: { median: number; p95: number };
    // per city id and "all"
    filters: Record<string, Record<FilterConfigId, FilterStats>>;
}

export function quantile(values: number[], q: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const median = (values: number[]) => quantile(values, 0.5);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function rowsFor(city: City, result: PairResult): Row[] {
    const v = result.variants;
    const shortest = v.shortest!;
    const valhalla = v.valhalla;
    const valhallaValid = !!valhalla?.ok && (valhalla.coverage ?? 0) >= MIN_COVERAGE;
    const comparable = (id: VariantId, r: VariantResult) => r.ok && (id !== "valhalla" || valhallaValid);
    const risks = VARIANTS.filter((id) => v[id] && comparable(id, v[id]!)).map((id) => v[id]!.risk!);
    const lowest = Math.min(...risks);

    return VARIANTS.map((id): Row => {
        const r = v[id] ?? { ok: false };
        const s = r.score;
        const km = (s?.distance ?? 0) / 1000;
        const groups = Object.fromEntries(GROUPS.map((g) => [g, s && s.distance > 0 ? s.groups[g] / s.distance : 0])) as Record<GroupId, number>;
        const hazards = Object.fromEntries(HAZARDS.map((h) => [h, km > 0 ? (s!.hazards[h] / km) * (h === "crossings" ? 10 : 1) : 0])) as Record<HazardId, number>;
        const ok = r.ok && shortest.ok;
        const distance = r.distance ?? 0;
        return {
            city: city.id,
            pair: result.pair.id,
            variant: id,
            ok: r.ok,
            valid: comparable(id, r) && shortest.ok,
            distance,
            risk: r.risk ?? 0,
            meanOr: r.ok ? r.risk! / distance : 0,
            detour: ok ? distance / shortest.distance! - 1 : 0,
            reduction: ok ? 1 - r.risk! / shortest.risk! : 0,
            reductionVsValhalla: r.ok && valhallaValid && id !== "valhalla" ? 1 - r.risk! / valhalla!.risk! : null,
            lts4Share: s && s.distance > 0 ? s.lts[3] / s.distance : 0,
            bikewayShare: s && s.distance > 0 ? s.bikeway / s.distance : 0,
            coverage: r.coverage ?? null,
            acceptable: ok && (distance / shortest.distance! < MAX_DETOUR_RATIO || distance - shortest.distance! < MAX_DETOUR_METERS),
            planMs: id !== "valhalla" && r.ms ? median(r.ms) : (r.ms?.[0] ?? null),
            planP95: id !== "valhalla" && r.ms ? quantile(r.ms, 0.95) : null,
            firstMs: r.firstMs ?? null,
            graphMs: result.graphMs,
            safest: comparable(id, r) && r.risk === lowest,
            groups,
            hazards,
            straight: result.pair.meters,
        };
    });
}

function stats(rows: Row[], id: VariantId, routes: Score[]): VariantStats {
    const own = rows.filter((r) => r.variant === id && r.valid);
    const compared = id === "shortest" ? [] : own;
    const lengths = sum(routes.map((s) => s.distance));
    const km = lengths / 1000;
    const vsValhalla = own.map((r) => r.reductionVsValhalla).filter((x): x is number => x !== null);
    return {
        n: own.length,
        reduction: compared.length > 0 ? {
            median: median(compared.map((r) => r.reduction)),
            q1: quantile(compared.map((r) => r.reduction), 0.25),
            q3: quantile(compared.map((r) => r.reduction), 0.75),
        } : null,
        reductionVsValhalla: vsValhalla.length > 0 ? median(vsValhalla) : null,
        detour: compared.length > 0 ? median(compared.map((r) => r.detour)) : null,
        lts4Share: lengths > 0 ? sum(routes.map((s) => s.lts[3])) / lengths : 0,
        bikewayShare: lengths > 0 ? sum(routes.map((s) => s.bikeway)) / lengths : 0,
        acceptable: compared.length > 0 ? compared.filter((r) => r.acceptable).length / compared.length : null,
        bands: compared.length > 0 ? DETOUR_BANDS.map((band) => compared.filter((r) => r.detour < band).length / compared.length) : null,
        wins: own.filter((r) => r.safest).length,
        groups: Object.fromEntries(GROUPS.map((g) => [g, lengths > 0 ? sum(routes.map((s) => s.groups[g])) / lengths : 0])) as Record<GroupId, number>,
        hazards: Object.fromEntries(HAZARDS.map((h) => [h, km > 0 ? (sum(routes.map((s) => s.hazards[h])) / km) * (h === "crossings" ? 10 : 1) : 0])) as Record<HazardId, number>,
        planMs: id === "valhalla" || own.length === 0 ? null : median(own.map((r) => r.planMs!)),
        planP95: id === "valhalla" || own.length === 0 ? null : quantile(own.map((r) => r.planMs!), 0.95),
    };
}

function statsFor(cityIds: string[], rows: Row[], routes: Record<string, CityRoutes>): Record<VariantId, VariantStats> {
    const inScope = rows.filter((r) => cityIds.includes(r.city));
    return Object.fromEntries(VARIANTS.map((id) => {
        const scores = cityIds.flatMap((c) => routes[c].pairs
            .filter((p) => inScope.some((r) => r.city === c && r.pair === p.pair.id && r.variant === id && r.valid))
            .map((p) => p.variants[id]!.score!));
        return [id, stats(inScope, id, scores)];
    })) as Record<VariantId, VariantStats>;
}

// best, worst and the two around the median of safest against the better of shortest and valhalla
function pickShowcase(city: string, rows: Row[]): Showcase[] {
    const byPair = new Map<number, Row[]>();
    rows.filter((r) => r.city === city).forEach((r) => byPair.set(r.pair, [...(byPair.get(r.pair) ?? []), r]));
    const scored = [...byPair.entries()].flatMap(([pair, pairRows]) => {
        const get = (id: VariantId) => pairRows.find((r) => r.variant === id)!;
        const [safest, shortest, valhalla] = [get("safest"), get("shortest"), get("valhalla")];
        if (!safest.valid || !shortest.valid || !valhalla.valid) return [];
        return [{ pair, score: 1 - safest.risk / Math.min(shortest.risk, valhalla.risk) }];
    }).sort((a, b) => b.score - a.score);
    if (scored.length === 0) return [];
    const mid = Math.floor((scored.length - 1) / 2);
    const picks: [number, Showcase["role"]][] = [[0, "best"], [mid, "median"], [mid + 1, "median"], [scored.length - 1, "worst"]];
    const used = new Set<number>();
    return picks.flatMap(([i, role]) => {
        if (i >= scored.length || used.has(i)) return [];
        used.add(i);
        return [{ city, pair: scored[i].pair, role, score: scored[i].score }];
    });
}

// safest and safest_filters from the routes stage, the single settings from the filters stage
function filterStats(cityIds: string[], routes: Record<string, CityRoutes>, runs: Record<string, PairFilterRuns[]>): Record<FilterConfigId, FilterStats> {
    const fromRoute = (r: VariantResult | undefined): FilterRun | null => (r?.ok && r.score
        ? { distance: r.distance!, risk: r.risk!, scored: r.score.distance, lts4: r.score.lts[3], bikeway: r.score.bikeway }
        : null);
    return Object.fromEntries(FILTER_CONFIGS.map((id) => {
        const pairs = cityIds.flatMap((c) => routes[c].pairs.flatMap((p) => {
            const shortest = p.variants.shortest;
            const own = id === "safest" || id === "safest_filters"
                ? fromRoute(p.variants[id])
                : runs[c].find((x) => x.pair === p.pair.id)?.runs[id] ?? null;
            return shortest?.ok && own ? [{ shortest, own }] : [];
        }));
        const scored = sum(pairs.map((x) => x.own.scored));
        return [id, {
            n: pairs.length,
            reduction: median(pairs.map((x) => 1 - x.own.risk / x.shortest.risk!)),
            detour: median(pairs.map((x) => x.own.distance / x.shortest.distance! - 1)),
            riskier: pairs.filter((x) => x.own.risk > x.shortest.risk! * (1 + 1e-9)).length,
            lts4Share: sum(pairs.map((x) => x.own.lts4)) / scored,
            bikewayShare: sum(pairs.map((x) => x.own.bikeway)) / scored,
        }];
    })) as Record<FilterConfigId, FilterStats>;
}

const pct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? "--" : num(100 * x, digits));
const ms = (x: number | null) => (x === null ? "--" : x < 100 ? num(x, 1) : num(x, 0));

// written as latex commands so the tables do not depend on the input encoding
const TEX_CHARS: Record<string, string> = {
    "à": "\\`a", "è": "\\`e", "é": "\\'e", "ì": "\\`i", "ò": "\\`o", "ù": "\\`u", "È": "\\`E",
    "ä": "\\\"a", "ö": "\\\"o", "ü": "\\\"u", "Ä": "\\\"A", "Ö": "\\\"O", "Ü": "\\\"U", "ß": "\\ss{}",
    "°": "$^\\circ$",
};

// labels like "5%" would start a latex comment
const texCell = (text: string) => text
    .replace(/(?<!\\)%/g, "\\%")
    .replace(/[àèéìòùÈäöüÄÖÜß°]/g, (c) => TEX_CHARS[c]);

interface Group {
    // empty for columns without a group
    label: string;
    span: number;
}

interface Table {
    file: string;
    caption: string;
    // optional first header row over groups of columns
    groups?: Group[];
    header: string[];
    // null draws a rule
    rows: (string[] | null)[];
    align?: string;
}

function latexTable(t: Table): string {
    const groupRows: string[] = [];
    if (t.groups) {
        const cells: string[] = [];
        const rules: string[] = [];
        let col = 1;
        for (const g of t.groups) {
            if (g.label === "") cells.push(...Array<string>(g.span).fill(""));
            else {
                cells.push(`\\multicolumn{${g.span}}{c}{${texCell(g.label)}}`);
                rules.push(`\\cmidrule(lr){${col}-${col + g.span - 1}}`);
            }
            col += g.span;
        }
        groupRows.push(cells.join(" & ") + " \\\\", rules.join(" "));
    }
    return [
        "\\begin{table}[htbp]",
        "\\centering",
        "\\small",
        `\\begin{tabular}{${t.align ?? "l" + "r".repeat(t.header.length - 1)}}`,
        "\\toprule",
        ...groupRows,
        t.header.map(texCell).join(" & ") + " \\\\",
        "\\midrule",
        ...t.rows.map((r) => (r === null ? "\\midrule" : r.map(texCell).join(" & ") + " \\\\")),
        "\\bottomrule",
        "\\end{tabular}",
        `\\caption{${texCell(t.caption)}}`,
        `\\label{${t.file.replace("_", ":")}}`,
        "\\end{table}",
        "",
    ].join("\n");
}

function csv(rows: Record<string, unknown>[]): string {
    const keys = Object.keys(rows[0]);
    const cell = (v: unknown) => (typeof v === "number" ? String(+v.toFixed(6)) : v === null || v === undefined ? "" : String(v));
    return [keys.join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n") + "\n";
}

export async function runAnalyze() {
    const routes = Object.fromEntries(CITIES.map((c) => [c.id, readJson<CityRoutes>(outPath("routes", `${c.id}.json`))]));
    const network = readJson<Record<string, Score>>(outPath("network.json"));
    const tags = readJson<Record<string, TagStats>>(outPath("tags.json"));
    const runs = Object.fromEntries(CITIES.map((c) => [c.id, readJson<PairFilterRuns[]>(outPath("filters", `${c.id}.json`))]));
    const snapshot = fs.existsSync(SNAPSHOT_FILE) ? readJson<Snapshot>(SNAPSHOT_FILE) : null;
    const valhallaStatus = fs.existsSync(VALHALLA_STATUS_FILE) ? readJson<any>(VALHALLA_STATUS_FILE) : null;

    const rows = CITIES.flatMap((city) => routes[city.id].pairs.flatMap((p) => rowsFor(city, p)));
    const cities = Object.fromEntries(CITIES.map((c) => [c.id, statsFor([c.id], rows, routes)]));
    const countries = Object.fromEntries(["IT", "DE"].map((country) => [country, statsFor(CITIES.filter((c) => c.country === country).map((c) => c.id), rows, routes)]));
    const all = statsFor(CITIES.map((c) => c.id), rows, routes);
    const showcase = CITIES.flatMap((c) => pickShowcase(c.id, rows));
    const graphTimes = CITIES.flatMap((c) => routes[c.id].pairs.map((p) => p.graphMs));
    const metrics: Metrics = {
        rows, cities, countries, all, network, showcase,
        travelled: Object.fromEntries(CITIES.map((c) => [c.id, routes[c.id].travelled])),
        graphMs: { median: median(graphTimes), p95: quantile(graphTimes, 0.95) },
        filters: {
            ...Object.fromEntries(CITIES.map((c) => [c.id, filterStats([c.id], routes, runs)])),
            all: filterStats(CITIES.map((c) => c.id), routes, runs),
        },
    };
    writeJson(outPath("metrics.json"), metrics);

    // routes as geojson, for a gis or the maps
    for (const city of CITIES) {
        const features = routes[city.id].pairs.flatMap((p) => VARIANTS.flatMap((id) => {
            const r = p.variants[id];
            if (!r?.ok || !r.geometry) return [];
            return [{
                type: "Feature",
                properties: { pair: p.pair.id, variant: id, distance: Math.round(r.distance!), risk: Math.round(r.risk!), coverage: r.coverage ?? null },
                geometry: { type: "LineString", coordinates: r.geometry },
            }];
        }));
        writeJson(outPath("geojson", `${city.id}.geojson`), { type: "FeatureCollection", features });
    }

    writeText(outPath("pairs.csv"), csv(rows.map(({ groups, hazards, ...rest }) => ({
        ...rest,
        ...Object.fromEntries(GROUPS.map((g) => [`share_${g}`, groups[g]])),
        ...Object.fromEntries(HAZARDS.map((h) => [`hazard_${h}`, hazards[h]])),
    }))));
    writeText(outPath("composition.csv"), csv(CITIES.flatMap((c) => [
        ...ROUTE_TYPES.map((t) => ({ city: c.id, scope: "network", route_type: t, meters: network[c.id].types[t] ?? 0 })),
        ...ROUTE_TYPES.map((t) => ({ city: c.id, scope: "travelled", route_type: t, meters: routes[c.id].travelled.types[t] ?? 0 })),
    ])));
    writeText(outPath("hazards.csv"), csv(CITIES.flatMap((c) => VARIANTS.flatMap((id) =>
        HAZARDS.map((h) => ({ city: c.id, variant: id, hazard: h, per_km: cities[c.id][id].hazards[h] }))))));
    writeText(outPath("osm_tags.csv"), csv(CITIES.flatMap((c) => [
        ...TAG_CHECKS.map((t) => ({ city: c.id, tag: t, meters: tags[c.id].checks[t].total, tagged: tags[c.id].checks[t].tagged })),
        { city: c.id, tag: "tram_tracks", meters: tags[c.id].tramTracks, tagged: null },
        { city: c.id, tag: "embedded_rails", meters: tags[c.id].embeddedRails, tagged: null },
    ])));

    const planned = PLANNER_VARIANTS.map((v) => v.id);
    const T = S.table;
    const V = S.variants;
    const cityRows = (cell: (s: Record<VariantId, VariantStats>) => string[]) => [
        ...CITIES.map((c) => [S.cities[c.id], ...cell(cities[c.id])]),
        null,
        [S.allCities, ...cell(all)],
    ];
    const tables: Table[] = [
        {
            file: "tab_risk",
            caption: T.riskCaption,
            header: [T.city, "$n$", V.safest, V.safest_filters, V.valhalla, `${V.safest} vs ${V.valhalla}`],
            rows: cityRows((s) => [String(s.valhalla.n), pct(s.safest.reduction?.median), pct(s.safest_filters.reduction?.median), pct(s.valhalla.reduction?.median), pct(s.safest.reductionVsValhalla)]),
        },
        {
            file: "tab_detour",
            caption: T.detourCaption,
            groups: [{ label: "", span: 1 }, { label: T.detourGroup, span: 3 }, { label: T.withinGroup, span: 3 }],
            header: [T.city, V.safest, V.safest_filters, V.valhalla, V.safest, V.safest_filters, V.valhalla],
            rows: cityRows((s) => [pct(s.safest.detour), pct(s.safest_filters.detour), pct(s.valhalla.detour), pct(s.safest.acceptable, 0), pct(s.safest_filters.acceptable, 0), pct(s.valhalla.acceptable, 0)]),
        },
        {
            file: "tab_lts4",
            caption: T.lts4Caption,
            header: [T.city, ...VARIANTS.map((id) => V[id])],
            rows: cityRows((s) => VARIANTS.map((id) => pct(s[id].lts4Share))),
        },
        {
            file: "tab_hazards",
            caption: T.hazardsCaption,
            header: [T.hazard, ...VARIANTS.map((id) => V[id])],
            rows: HAZARDS.map((h) => [S.hazards[h], ...VARIANTS.map((id) => num(all[id].hazards[h], 1))]),
        },
        {
            file: "tab_timing",
            caption: T.timingCaption,
            groups: [{ label: "", span: 1 }, { label: T.graph, span: 1 }, ...planned.map((id) => ({ label: V[id], span: 2 }))],
            header: [T.city, T.median, ...planned.flatMap(() => [T.median, T.p95])],
            rows: [
                ...CITIES.map((c) => [
                    S.cities[c.id],
                    num(median(routes[c.id].pairs.map((p) => p.graphMs)) / 1000, 1),
                    ...planned.flatMap((id) => [ms(cities[c.id][id].planMs), ms(cities[c.id][id].planP95)]),
                ]),
                null,
                [S.allCities, num(metrics.graphMs.median / 1000, 1), ...planned.flatMap((id) => [ms(all[id].planMs), ms(all[id].planP95)])],
            ],
        },
        {
            file: "tab_composition",
            caption: T.compositionCaption,
            header: [T.roadType, ...CITIES.map((c) => S.cities[c.id])],
            rows: ROUTE_TYPES.map((t) => [S.routeTypes[t], ...CITIES.map((c) => pct((network[c.id].types[t] ?? 0) / network[c.id].distance))]),
        },
        {
            file: "tab_filters",
            caption: T.filtersCaption,
            header: [T.configuration, T.reduction, T.detour, T.riskier, T.lts4, T.bikeway],
            rows: FILTER_CONFIGS.map((id) => {
                const f = metrics.filters.all[id];
                return [S.filterConfigs[id], pct(f.reduction), pct(f.detour), `${f.riskier} / ${f.n}`, pct(f.lts4Share), pct(f.bikewayShare)];
            }),
        },
        {
            file: "tab_osm_tags",
            caption: T.tagsCaption,
            groups: [{ label: "", span: 1 }, { label: T.tagsGroup, span: TAG_CHECKS.length }, { label: T.railsGroup, span: 2 }],
            header: [T.city, ...TAG_CHECKS.map((t) => S.tags[t]), S.tags.tramTracks, S.tags.embeddedRails],
            rows: CITIES.map((c) => {
                const t = tags[c.id];
                return [
                    S.cities[c.id],
                    ...TAG_CHECKS.map((id) => pct(t.checks[id].total > 0 ? t.checks[id].tagged / t.checks[id].total : null)),
                    num(t.tramTracks / 1000, 1),
                    num(t.embeddedRails / 1000, 1),
                ];
            }),
        },
        {
            file: "tab_showcase",
            caption: T.showcaseCaption,
            groups: [{ label: "", span: 4 }, { label: T.reductionGroup, span: 3 }],
            header: [T.city, T.pair, T.case, T.shortestKm, T.vsShortest, T.vsValhalla, T.index],
            align: "lrlrrrr",
            rows: showcase.flatMap((s, i) => {
                const r = (id: VariantId) => rows.find((x) => x.city === s.city && x.pair === s.pair && x.variant === id)!;
                const row = [S.cities[s.city], String(s.pair), S.roles[s.role], num(r("shortest").distance / 1000, 1), pct(r("safest").reduction), pct(r("safest").reductionVsValhalla), pct(s.score)];
                return i > 0 && showcase[i - 1].city !== s.city ? [null, row] : [row];
            }),
        },
    ];
    fs.rmSync(outPath("tables"), { recursive: true, force: true });
    for (const t of tables) writeText(outPath("tables", `${t.file}.tex`), latexTable(t));

    const inconsistent = rows.filter((r) => r.variant !== "valhalla" && r.ok
        && routes[r.city].pairs.find((p) => p.pair.id === r.pair)!.variants[r.variant]!.consistent === false);
    const failed = rows.filter((r) => !r.ok);
    const coverages = rows.filter((r) => r.variant === "valhalla" && r.coverage !== null).map((r) => r.coverage!);
    const lowCoverage = rows.filter((r) => r.variant === "valhalla" && r.ok && !r.valid);
    const riskier = rows.filter((r) => r.variant === "safest" && r.valid && r.reduction < -1e-9);
    const valhallaDate = valhallaStatus?.tileset_last_modified
        ? new Date(valhallaStatus.tileset_last_modified * 1000).toISOString().slice(0, 10)
        : "unknown";
    console.log([
        `OSM data: ${snapshot?.osmBase ?? "unknown"}, Valhalla ${valhallaStatus?.version ?? "?"} data: ${valhallaDate}`,
        `${rows.length / VARIANTS.length} pairs, failed routes: ${failed.map((r) => `${r.city} ${r.pair} ${r.variant}`).join(", ") || "none"}`,
        `edges not matching the planner's totals: ${inconsistent.length}, safest riskier than shortest: ${riskier.length}`,
        `valhalla matched: median ${pct(coverages.length ? median(coverages) : null)}%, min ${pct(coverages.length ? Math.min(...coverages) : null)}%, `
            + `${lowCoverage.length} below ${pct(MIN_COVERAGE, 0)}% left out of the risk comparisons`,
    ].join("\n"));
}
