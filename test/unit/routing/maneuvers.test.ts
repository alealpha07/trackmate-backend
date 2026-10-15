import { describe, expect, test } from "vitest";
import { joinChunks, placeManeuvers, placeSpeedLimits, splitTrack, tripPieces } from "../../../src/routing/instructions/maneuvers.js";
import { encodePolyline6 } from "../../../src/routing/instructions/polyline.js";
import { Maneuver } from "../../../src/routing/types.js";
import { nodeAt } from "../../helpers/graph.js";

const at = (x: number, y: number) => {
    const { lat, lon } = nodeAt(x, y);
    return { lat, lng: lon };
};
// 1 km north, a point every 100 m
const TRACK = Array.from({ length: 11 }, (_, i) => at(0, i * 100));
const SHAPE = encodePolyline6(TRACK);

const valhallaManeuvers = [
    { type: 1, instruction: "Head north.", begin_shape_index: 0, length: 0.5, time: 60 },
    {
        type: 10, instruction: "Turn right onto Via Roma.", street_names: ["Via Roma"], begin_shape_index: 5,
        length: 0.5, time: 60, verbal_pre_transition_instruction: "Turn right onto Via Roma.",
        verbal_post_transition_instruction: "Continue for 500 meters.",
    },
    { type: 4, instruction: "You have arrived.", begin_shape_index: 10, length: 0, time: 0 },
];

describe("tripPieces", () => {
    test("the trip and the alternates that have legs", () => {
        const trip = { legs: [{}] };
        expect(tripPieces({ trip, alternates: [{ trip: { legs: [] } }, { trip }] })).toEqual([trip, trip]);
        expect(tripPieces(null)).toEqual([]);
    });
});

describe("placeManeuvers", () => {
    test("each maneuver at its place along the track", () => {
        const maneuvers = placeManeuvers([{ legs: [{ shape: SHAPE, maneuvers: valhallaManeuvers }] }], TRACK);
        expect(maneuvers.map((m) => m.type)).toEqual([1, 10, 4]);
        expect(maneuvers.map((m) => Math.round(m.along))).toEqual([0, 500, 1000]);
        expect(maneuvers[1]).toMatchObject({
            text: "Turn right onto Via Roma.", streets: ["Via Roma"], length: 500, time: 60,
            verbalPre: "Turn right onto Via Roma.", verbalPost: "Continue for 500 meters.",
        });
        expect(maneuvers[0].streets).toEqual([]);
        expect(maneuvers[0].verbalPre).toBeNull();
    });
});

describe("placeSpeedLimits", () => {
    test("joins equal limits next to each other, skips missing ones", () => {
        const limits = placeSpeedLimits({
            shape: SHAPE,
            edges: [
                { begin_shape_index: 0, end_shape_index: 3, length: 0.3, speed_limit: 50 },
                { begin_shape_index: 3, end_shape_index: 5, length: 0.2, speed_limit: 50 },
                { begin_shape_index: 5, end_shape_index: 7, length: 0.2, speed_limit: 0 },
                { begin_shape_index: 7, end_shape_index: 10, length: 0.3, speed_limit: 30 },
            ],
        }, TRACK);
        expect(limits.map((l) => [Math.round(l.from), Math.round(l.to), l.kmh])).toEqual([[0, 500, 50], [700, 1000, 30]]);
    });
});

describe("splitTrack and joinChunks", () => {
    test("a short track is one chunk", () => {
        const [chunk, ...rest] = splitTrack(TRACK);
        expect(rest).toHaveLength(0);
        expect(chunk).toMatchObject({ offset: 0, keepFrom: -Infinity, keepTo: Infinity });
        expect(chunk.points).toEqual(TRACK);
    });

    test("a long track is cut every 100 km with some overlap", () => {
        const long = Array.from({ length: 251 }, (_, i) => at(0, i * 1000));
        const chunks = splitTrack(long);
        expect(chunks.map((c) => [c.keepFrom, c.keepTo])).toEqual([[-Infinity, 100_000], [100_000, 200_000], [200_000, Infinity]]);
        expect(Math.round(chunks[1].offset)).toBe(99_000);
        expect(chunks[1].points[0]).toEqual(long[99]);
    });

    test("joining keeps each chunk's own part and fixes the maneuver before a cut", () => {
        const maneuver = (along: number, length: number): Maneuver =>
            ({ type: 8, text: "", streets: [], along, length, time: length / 10, verbalPre: null, verbalPost: "post" });
        const first = { points: [], offset: 0, keepFrom: -Infinity, keepTo: 100 };
        const second = { points: [], offset: 90, keepFrom: 100, keepTo: Infinity };
        const joined = joinChunks([
            { chunk: first, result: { maneuvers: [maneuver(0, 120)], speedLimits: [{ from: 0, to: 105, kmh: 50 }] } },
            { chunk: second, result: { maneuvers: [maneuver(5, 10), maneuver(20, 30)], speedLimits: [{ from: 5, to: 50, kmh: 50 }] } },
        ]);
        expect(joined.maneuvers.map((m) => m.along)).toEqual([0, 110]);
        expect(joined.maneuvers[0]).toMatchObject({ length: 110, time: 11, verbalPost: null });
        expect(joined.speedLimits).toEqual([{ from: 0, to: 140, kmh: 50 }]);
    });
});
