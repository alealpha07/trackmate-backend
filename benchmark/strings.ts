import type { RouteType } from "../src/routing/types.js";
import { FilterConfigId, GroupId, HazardId, LANGUAGE, Language, TagCheckId, VariantId } from "./config.js";

export interface Strings {
    decimal: string;
    cities: Record<string, string>;
    countries: { IT: string; DE: string };
    allCities: string;
    variants: Record<VariantId, string>;
    filterConfigs: Record<FilterConfigId, string>;
    groups: Record<GroupId, string>;
    routeTypes: Record<RouteType, string>;
    hazards: Record<HazardId, string>;
    tags: Record<TagCheckId | "tramTracks" | "embeddedRails", string>;
    roles: { best: string; median: string; worst: string };
    chart: {
        network: string;
        travelled: string;
        lengthShare: string;
        travelledShare: string;
        reduction: string;
        detour: string;
        cumulative: string;
        threshold: (pct: number) => string;
        band: (pct: number) => string;
        lts4: string;
        exposure: string;
        straight: string;
        planTime: string;
        wins: string;
        medianReduction: string;
    };
    map: {
        title: (city: string, pair: number, role: string) => string;
        risk: string;
    };
    table: {
        city: string;
        hazard: string;
        roadType: string;
        graph: string;
        pair: string;
        case: string;
        shortestKm: string;
        vsShortest: string;
        vsValhalla: string;
        index: string;
        withinShort: (variant: string) => string;
        riskCaption: string;
        detourCaption: string;
        lts4Caption: string;
        hazardsCaption: string;
        timingCaption: (repeats: number) => string;
        compositionCaption: string;
        showcaseCaption: string;
        tagsCaption: string;
        configuration: string;
        reduction: string;
        detour: string;
        riskier: string;
        lts4: string;
        bikeway: string;
        filtersCaption: string;
    };
}

const it: Strings = {
    decimal: ",",
    cities: { milan: "Milano", parma: "Parma", turin: "Torino", berlin: "Berlino", munich: "Monaco", frankfurt: "Francoforte" },
    countries: { IT: "Italia", DE: "Germania" },
    allCities: "Tutte",
    variants: { shortest: "Shortest", safest: "Safest", safest_filters: "Safest + filtri", valhalla: "Valhalla" },
    filterConfigs: {
        safest: "Safest",
        cap: "Safest, deviazione max 25%",
        lts4: "Safest, evita LTS 4",
        cycleways: "Safest, solo ciclabili",
        safest_filters: "Safest + filtri",
    },
    groups: {
        cycle_track: "Pista ciclabile separata",
        path: "Percorso ciclabile o misto",
        local: "Strada locale",
        major_lane: "Strada principale con corsia ciclabile",
        major: "Strada principale senza corsia",
        sidewalk: "Marciapiede o area pedonale",
    },
    routeTypes: {
        cycle_track: "Pista separata dalla strada",
        local_bike_route: "Strada locale ciclabile",
        local: "Strada locale",
        major_lane: "Principale, corsia ciclabile",
        bike_path: "Pista ciclabile in sede propria",
        major_shared: "Principale, corsia condivisa",
        major: "Principale",
        major_parked_lane: "Principale, sosta e corsia ciclabile",
        major_parked_shared: "Principale, sosta e corsia condivisa",
        multiuse_unpaved: "Percorso misto non pavimentato",
        multiuse_paved: "Percorso misto pavimentato",
        sidewalk: "Marciapiede o area pedonale",
        major_parked: "Principale con sosta",
    },
    hazards: {
        tram: "Binari tranviari (m/km)",
        crossings: "Attraversamenti ferroviari (n/10 km)",
        downhill: "Discesa oltre il 5% (m/km)",
        construction: "Cantieri (m/km)",
        lts4: "LTS 4 (m/km)",
        parked: "Principale con sosta (m/km)",
        unpaved: "Fondo non pavimentato (m/km)",
    },
    tags: {
        parking: "Sosta",
        maxspeed: "Limite",
        sidepath: "Piste laterali",
        designated: "Percorsi condivisi",
        surface: "Fondo",
        tramTracks: "Binari tram (km)",
        embeddedRails: "Binari su strada (km)",
    },
    roles: { best: "caso migliore", median: "caso mediano", worst: "caso peggiore" },
    chart: {
        network: "rete",
        travelled: "percorsa",
        lengthShare: "Quota della lunghezza",
        travelledShare: "Quota della lunghezza percorsa",
        reduction: "Riduzione del rischio rispetto a Shortest",
        detour: "Deviazione rispetto a Shortest",
        cumulative: "Quota cumulata dei percorsi",
        threshold: (pct) => `Soglia ${pct}%`,
        band: (pct) => `Fascia ${pct}%`,
        lts4: "Lunghezza su LTS 4",
        exposure: "Esposizione, tutte le città",
        straight: "Distanza in linea d'aria (km)",
        planTime: "Tempo di calcolo, grafo in memoria (ms)",
        wins: "Coppie in cui la variante è la più sicura",
        medianReduction: "Riduzione mediana del rischio rispetto a Shortest",
    },
    map: {
        title: (city, pair, role) => `${city}, coppia ${pair} (${role})`,
        risk: "rischio",
    },
    table: {
        city: "Città",
        hazard: "Pericolo",
        roadType: "Tipo di strada",
        graph: "Grafo (s)",
        pair: "Coppia",
        case: "Caso",
        shortestKm: "Shortest (km)",
        vsShortest: "Rid. vs Shortest",
        vsValhalla: "Rid. vs Valhalla",
        index: "Indice",
        withinShort: (variant) => `Soglia ${variant}`,
        riskCaption: "Riduzione mediana del rischio rispetto a Shortest (\\%) e, nell'ultima colonna, di Safest rispetto a Valhalla. $n$: coppie con Valhalla confrontabile.",
        detourCaption: "Deviazione mediana rispetto a Shortest (\\%) e quota di percorsi entro la soglia di accettabilità (25\\% o 536 m).",
        lts4Caption: "Quota della lunghezza percorsa su strade ad alto stress (LTS 4, \\%).",
        hazardsCaption: "Esposizione ai singoli pericoli, su tutte le città.",
        timingCaption: (repeats) => `Tempo di calcolo del planner con il grafo già in memoria (ms, mediana / 95° percentile su ${repeats} ripetizioni per coppia) e costruzione del grafo a freddo (s, mediana).`,
        compositionCaption: "Composizione della rete ciclabile nelle aree di studio per tipo di strada del modello di rischio (\\% della lunghezza).",
        showcaseCaption: "Casi showcase: per ogni città la coppia migliore, le due mediane e la peggiore per riduzione del rischio di Safest rispetto al più sicuro tra Shortest e Valhalla.",
        tagsCaption: "Completezza dei tag OpenStreetMap nelle aree di studio (\\% della lunghezza): strade principali con tag \\texttt{parking:*} e con \\texttt{maxspeed}, piste \\texttt{highway=cycleway} con \\texttt{is\\_sidepath=yes}, percorsi pedonali con \\texttt{bicycle=designated}, percorsi con \\texttt{surface} o \\texttt{tracktype}. Binari del tram mappati come vie separate, ogni binario contato, e strade con binari incorporati (km).",
        configuration: "Configurazione",
        reduction: "Riduzione (%)",
        detour: "Deviazione (%)",
        riskier: "Più rischiosi di Shortest",
        lts4: "LTS 4 (%)",
        bikeway: "Ciclabile (%)",
        filtersCaption: "Safest con una sola impostazione di Safest + filtri alla volta, su tutte le città: riduzione mediana del rischio e deviazione mediana rispetto a Shortest, percorsi più rischiosi di Shortest e quote della lunghezza su LTS 4 e su infrastruttura ciclabile. Le righe con un filtro includono il limite di deviazione del 25\\%.",
    },
};

const en: Strings = {
    decimal: ".",
    cities: { milan: "Milan", parma: "Parma", turin: "Turin", berlin: "Berlin", munich: "Munich", frankfurt: "Frankfurt" },
    countries: { IT: "Italy", DE: "Germany" },
    allCities: "All",
    variants: { shortest: "Shortest", safest: "Safest", safest_filters: "Safest + filters", valhalla: "Valhalla" },
    filterConfigs: {
        safest: "Safest",
        cap: "Safest, detour up to 25%",
        lts4: "Safest, avoid LTS 4",
        cycleways: "Safest, cycleways only",
        safest_filters: "Safest + filters",
    },
    groups: {
        cycle_track: "Separated cycle track",
        path: "Bike or shared path",
        local: "Local street",
        major_lane: "Major road with bike lane",
        major: "Major road without bike lane",
        sidewalk: "Sidewalk or pedestrian area",
    },
    routeTypes: {
        cycle_track: "Cycle track beside the road",
        local_bike_route: "Local street bike route",
        local: "Local street",
        major_lane: "Major, bike lane",
        bike_path: "Off-road bike path",
        major_shared: "Major, shared lane",
        major: "Major",
        major_parked_lane: "Major, parking and bike lane",
        major_parked_shared: "Major, parking and shared lane",
        multiuse_unpaved: "Unpaved multi-use path",
        multiuse_paved: "Paved multi-use path",
        sidewalk: "Sidewalk or pedestrian area",
        major_parked: "Major with parking",
    },
    hazards: {
        tram: "Tram tracks (m/km)",
        crossings: "Rail crossings (n/10 km)",
        downhill: "Downhill over 5% (m/km)",
        construction: "Construction (m/km)",
        lts4: "LTS 4 (m/km)",
        parked: "Major with parking (m/km)",
        unpaved: "Unpaved (m/km)",
    },
    tags: {
        parking: "Parking",
        maxspeed: "Speed limit",
        sidepath: "Sidepaths",
        designated: "Shared paths",
        surface: "Surface",
        tramTracks: "Tram tracks (km)",
        embeddedRails: "Rails in road (km)",
    },
    roles: { best: "best case", median: "median case", worst: "worst case" },
    chart: {
        network: "network",
        travelled: "travelled",
        lengthShare: "Share of length",
        travelledShare: "Share of travelled length",
        reduction: "Risk reduction against Shortest",
        detour: "Detour against Shortest",
        cumulative: "Cumulative share of routes",
        threshold: (pct) => `Threshold ${pct}%`,
        band: (pct) => `Band ${pct}%`,
        lts4: "Length on LTS 4",
        exposure: "Exposure, all cities",
        straight: "Straight-line distance (km)",
        planTime: "Planning time, graph in memory (ms)",
        wins: "Pairs where the variant is the safest",
        medianReduction: "Median risk reduction against Shortest",
    },
    map: {
        title: (city, pair, role) => `${city}, pair ${pair} (${role})`,
        risk: "risk",
    },
    table: {
        city: "City",
        hazard: "Hazard",
        roadType: "Road type",
        graph: "Graph (s)",
        pair: "Pair",
        case: "Case",
        shortestKm: "Shortest (km)",
        vsShortest: "Red. vs Shortest",
        vsValhalla: "Red. vs Valhalla",
        index: "Index",
        withinShort: (variant) => `Within ${variant}`,
        riskCaption: "Median risk reduction against Shortest (\\%) and, in the last column, of Safest against Valhalla. $n$: pairs with a comparable Valhalla route.",
        detourCaption: "Median detour against Shortest (\\%) and share of routes within the acceptable detour (25\\% or 536 m).",
        lts4Caption: "Share of the travelled length on high-stress roads (LTS 4, \\%).",
        hazardsCaption: "Exposure to each hazard, all cities.",
        timingCaption: (repeats) => `Planning time with the graph in memory (ms, median / 95th percentile over ${repeats} runs per pair) and cold graph build (s, median).`,
        compositionCaption: "Composition of the bike network in the study areas by road type of the risk model (\\% of length).",
        showcaseCaption: "Showcase pairs: per city the best, the two median and the worst pair by Safest's risk reduction against the safer of Shortest and Valhalla.",
        tagsCaption: "Completeness of the OpenStreetMap tags in the study areas (\\% of length): major roads with a \\texttt{parking:*} tag and with \\texttt{maxspeed}, \\texttt{highway=cycleway} with \\texttt{is\\_sidepath=yes}, footways with \\texttt{bicycle=designated}, paths with \\texttt{surface} or \\texttt{tracktype}. Tram tracks mapped as their own ways, each track counted, and streets with rails in the road (km).",
        configuration: "Setting",
        reduction: "Reduction (%)",
        detour: "Detour (%)",
        riskier: "Riskier than Shortest",
        lts4: "LTS 4 (%)",
        bikeway: "Bikeway (%)",
        filtersCaption: "Safest with one setting of Safest + filters at a time, all cities: median risk reduction and median detour against Shortest, routes riskier than Shortest, and shares of length on LTS 4 and on bike infrastructure. The rows with a filter include the 25\\% detour limit.",
    },
};

const de: Strings = {
    decimal: ",",
    cities: { milan: "Mailand", parma: "Parma", turin: "Turin", berlin: "Berlin", munich: "München", frankfurt: "Frankfurt" },
    countries: { IT: "Italien", DE: "Deutschland" },
    allCities: "Alle",
    variants: { shortest: "Shortest", safest: "Safest", safest_filters: "Safest + Filter", valhalla: "Valhalla" },
    filterConfigs: {
        safest: "Safest",
        cap: "Safest, Umweg bis 25%",
        lts4: "Safest, LTS 4 meiden",
        cycleways: "Safest, nur Radwege",
        safest_filters: "Safest + Filter",
    },
    groups: {
        cycle_track: "Baulicher Radweg",
        path: "Rad- oder gemeinsamer Weg",
        local: "Nebenstraße",
        major_lane: "Hauptstraße mit Radfahrstreifen",
        major: "Hauptstraße ohne Radfahrstreifen",
        sidewalk: "Gehweg oder Fußgängerzone",
    },
    routeTypes: {
        cycle_track: "Radweg neben der Straße",
        local_bike_route: "Fahrradstraße",
        local: "Nebenstraße",
        major_lane: "Hauptstraße, Radfahrstreifen",
        bike_path: "Selbstständiger Radweg",
        major_shared: "Hauptstraße, Schutzstreifen",
        major: "Hauptstraße",
        major_parked_lane: "Hauptstraße, Parken und Radfahrstreifen",
        major_parked_shared: "Hauptstraße, Parken und Schutzstreifen",
        multiuse_unpaved: "Unbefestigter gemeinsamer Weg",
        multiuse_paved: "Befestigter gemeinsamer Weg",
        sidewalk: "Gehweg oder Fußgängerzone",
        major_parked: "Hauptstraße mit Parken",
    },
    hazards: {
        tram: "Straßenbahngleise (m/km)",
        crossings: "Bahnübergänge (n/10 km)",
        downhill: "Gefälle über 5% (m/km)",
        construction: "Baustellen (m/km)",
        lts4: "LTS 4 (m/km)",
        parked: "Hauptstraße mit Parken (m/km)",
        unpaved: "Unbefestigt (m/km)",
    },
    tags: {
        parking: "Parken",
        maxspeed: "Tempolimit",
        sidepath: "Begleitwege",
        designated: "Gemeinsame Wege",
        surface: "Belag",
        tramTracks: "Straßenbahngleise (km)",
        embeddedRails: "Gleise in der Fahrbahn (km)",
    },
    roles: { best: "bester Fall", median: "mittlerer Fall", worst: "schlechtester Fall" },
    chart: {
        network: "Netz",
        travelled: "befahren",
        lengthShare: "Anteil der Länge",
        travelledShare: "Anteil der gefahrenen Länge",
        reduction: "Risikominderung gegenüber Shortest",
        detour: "Umweg gegenüber Shortest",
        cumulative: "Kumulierter Anteil der Routen",
        threshold: (pct) => `Schwelle ${pct}%`,
        band: (pct) => `Band ${pct}%`,
        lts4: "Länge auf LTS 4",
        exposure: "Exposition, alle Städte",
        straight: "Luftlinie (km)",
        planTime: "Rechenzeit, Graph im Speicher (ms)",
        wins: "Paare, in denen die Variante die sicherste ist",
        medianReduction: "Mediane Risikominderung gegenüber Shortest",
    },
    map: {
        title: (city, pair, role) => `${city}, Paar ${pair} (${role})`,
        risk: "Risiko",
    },
    table: {
        city: "Stadt",
        hazard: "Gefahr",
        roadType: "Straßentyp",
        graph: "Graph (s)",
        pair: "Paar",
        case: "Fall",
        shortestKm: "Shortest (km)",
        vsShortest: "Min. vs Shortest",
        vsValhalla: "Min. vs Valhalla",
        index: "Index",
        withinShort: (variant) => `Schwelle ${variant}`,
        riskCaption: "Mediane Risikominderung gegenüber Shortest (\\%) und, in der letzten Spalte, von Safest gegenüber Valhalla. $n$: Paare mit vergleichbarer Valhalla-Route.",
        detourCaption: "Medianer Umweg gegenüber Shortest (\\%) und Anteil der Routen innerhalb des akzeptablen Umwegs (25\\% oder 536 m).",
        lts4Caption: "Anteil der gefahrenen Länge auf Straßen mit hohem Stress (LTS 4, \\%).",
        hazardsCaption: "Exposition gegenüber den einzelnen Gefahren, alle Städte.",
        timingCaption: (repeats) => `Rechenzeit mit dem Graph im Speicher (ms, Median / 95. Perzentil über ${repeats} Läufe pro Paar) und kalter Graphaufbau (s, Median).`,
        compositionCaption: "Zusammensetzung des Radnetzes in den Untersuchungsgebieten nach Straßentyp des Risikomodells (\\% der Länge).",
        showcaseCaption: "Beispielpaare: pro Stadt das beste, die zwei mittleren und das schlechteste Paar nach Risikominderung von Safest gegenüber dem sichereren von Shortest und Valhalla.",
        tagsCaption: "Vollständigkeit der OpenStreetMap-Tags in den Untersuchungsgebieten (\\% der Länge): Hauptstraßen mit \\texttt{parking:*}-Tag und mit \\texttt{maxspeed}, \\texttt{highway=cycleway} mit \\texttt{is\\_sidepath=yes}, Fußwege mit \\texttt{bicycle=designated}, Wege mit \\texttt{surface} oder \\texttt{tracktype}. Straßenbahngleise als eigene Wege, jedes Gleis gezählt, und Straßen mit Gleisen in der Fahrbahn (km).",
        configuration: "Einstellung",
        reduction: "Minderung (%)",
        detour: "Umweg (%)",
        riskier: "Riskanter als Shortest",
        lts4: "LTS 4 (%)",
        bikeway: "Radinfrastruktur (%)",
        filtersCaption: "Safest mit jeweils einer Einstellung von Safest + Filter, alle Städte: mediane Risikominderung und medianer Umweg gegenüber Shortest, Routen riskanter als Shortest und Anteile der Länge auf LTS 4 und auf Radinfrastruktur. Die Zeilen mit einem Filter enthalten die Umweggrenze von 25\\%.",
    },
};

export const STRINGS: Record<Language, Strings> = { it, en, de };

export const S = STRINGS[LANGUAGE];

// decimal separator of the language
export function num(x: number, digits = 1): string {
    return x.toFixed(digits).replace(".", S.decimal);
}
