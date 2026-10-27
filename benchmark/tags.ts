import { hasEmbeddedRails, PATH_HIGHWAYS } from "../src/routing/graph/osmTags.js";
import { haversineMeters } from "../src/routing/haversine.js";
import { BBox, OverpassElement, OverpassNode, Tags } from "../src/routing/types.js";
import { MAJOR_HIGHWAYS, TAG_CHECKS, TagCheckId } from "./config.js";

export interface TagStats {
    // meters of the ways a check applies to, and of those carrying the tag
    checks: Record<TagCheckId, { total: number; tagged: number }>;
    // meters of tram tracks mapped as their own ways, each track counted
    tramTracks: number;
    // meters of streets tagged with rails in the road
    embeddedRails: number;
}

const FOOT_HIGHWAYS = ["footway", "path", "pedestrian"];

// which ways a check applies to, and whether the tag is there
const CHECKS: Record<TagCheckId, { applies: (tags: Tags) => boolean; tagged: (tags: Tags) => boolean }> = {
    parking: {
        applies: (t) => MAJOR_HIGHWAYS.includes(t.highway),
        tagged: (t) => Object.keys(t).some((k) => k.startsWith("parking:")),
    },
    maxspeed: { applies: (t) => MAJOR_HIGHWAYS.includes(t.highway), tagged: (t) => t.maxspeed !== undefined },
    sidepath: { applies: (t) => t.highway === "cycleway", tagged: (t) => t.is_sidepath === "yes" },
    designated: { applies: (t) => FOOT_HIGHWAYS.includes(t.highway), tagged: (t) => t.bicycle === "designated" },
    surface: {
        applies: (t) => PATH_HIGHWAYS.includes(t.highway),
        tagged: (t) => t.surface !== undefined || t.tracktype !== undefined,
    },
};

// a way belongs to the box its middle node is in
export function tagStats(elements: OverpassElement[], box: BBox): TagStats {
    const nodes = new Map<number, OverpassNode>();
    for (const el of elements) if (el.type === "node") nodes.set(el.id, el);

    const stats: TagStats = {
        checks: Object.fromEntries(TAG_CHECKS.map((c) => [c, { total: 0, tagged: 0 }])) as TagStats["checks"],
        tramTracks: 0,
        embeddedRails: 0,
    };
    const seen = new Set<number>();
    for (const el of elements) {
        if (el.type !== "way" || seen.has(el.id)) continue;
        seen.add(el.id);
        const points = el.nodes.map((id) => nodes.get(id)).filter((n): n is OverpassNode => !!n);
        if (points.length < 2) continue;
        const mid = points[Math.floor(points.length / 2)];
        if (mid.lat < box.south || mid.lat > box.north || mid.lon < box.west || mid.lon > box.east) continue;

        let meters = 0;
        for (let i = 1; i < points.length; i++) {
            meters += haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
        }
        const tags = el.tags ?? {};
        for (const id of TAG_CHECKS) {
            if (!CHECKS[id].applies(tags)) continue;
            stats.checks[id].total += meters;
            if (CHECKS[id].tagged(tags)) stats.checks[id].tagged += meters;
        }
        if (tags.railway === "tram") stats.tramTracks += meters;
        else if (tags.highway && hasEmbeddedRails(tags)) stats.embeddedRails += meters;
    }
    return stats;
}
