import path from "path";
import i18n from "i18n";
import { describe, expect, test } from "vitest";
import { Response } from "express";
import { QuestType, Vehicle } from "../../src/generated/prisma/client.js";
import { QUESTS_PER_VEHICLE, dailyQuests, questPool, questText } from "../../src/quests.js";
import { isPlannable, parseVehicle, vehicleClass, vehicleCosting } from "../../src/vehicles.js";

i18n.configure({
    locales: ["en", "it", "de"],
    directory: path.join(import.meta.dirname, "..", "..", "locales"),
    defaultLocale: "en",
    objectNotation: true,
    updateFiles: false,
    syncFiles: false,
    autoReload: false,
});

function response(language: string): Response {
    const request: any = { headers: { "accept-language": language }, url: "/" };
    const response: any = { locals: {} };
    i18n.init(request, response, () => {});
    return response;
}

const VEHICLES = Object.values(Vehicle);

describe("vehicles", () => {
    test("parseVehicle takes any case, nothing else", () => {
        expect(parseVehicle("bicycle")).toBe("BICYCLE");
        expect(parseVehicle("CAR")).toBe("CAR");
        expect(parseVehicle("plane")).toBeNull();
        expect(parseVehicle(1)).toBeNull();
    });

    test("only bicycles can be planned for now", () => {
        expect(isPlannable("bicycle")).toBe(true);
        expect(isPlannable("car")).toBe(false);
        expect(isPlannable("BICYCLE")).toBe(false);
    });

    test("every vehicle has a class and a Valhalla costing", () => {
        for (const vehicle of VEHICLES) {
            expect(vehicleClass(vehicle)).toBeTruthy();
            expect(vehicleCosting(vehicle)).toBeTruthy();
        }
        expect(vehicleCosting("FOOT")).toBe("pedestrian");
    });
});

describe("dailyQuests", () => {
    test("two of different types per vehicle", () => {
        for (let run = 0; run < 20; run++) {
            const quests = dailyQuests(["CAR", "BICYCLE"]);
            expect(quests).toHaveLength(2 * QUESTS_PER_VEHICLE);
            for (const vehicle of ["CAR", "BICYCLE"] as Vehicle[]) {
                const own = quests.filter((q) => q.vehicle === vehicle);
                expect(own).toHaveLength(QUESTS_PER_VEHICLE);
                expect(new Set(own.map((q) => q.type)).size).toBe(QUESTS_PER_VEHICLE);
            }
        }
        expect(dailyQuests([])).toEqual([]);
    });

    test("the pool has every type for every vehicle", () => {
        for (const vehicle of VEHICLES) {
            expect(new Set(questPool(vehicle).map((q) => q.type))).toEqual(new Set(Object.values(QuestType)));
        }
    });
});

describe("questText", () => {
    test("every quest in every language, with its number", () => {
        for (const language of ["en", "it", "de"]) {
            const res = response(language);
            for (const vehicle of VEHICLES) {
                for (const quest of questPool(vehicle)) {
                    const text = questText(quest, res);
                    expect(text).not.toMatch(/^quest\./);
                    expect(text).toContain(String(quest.maxProgress));
                }
            }
        }
    });

    test("english matches the stored description", () => {
        const res = response("en");
        for (const quest of questPool("BICYCLE")) expect(questText(quest, res)).toBe(quest.description);
    });

    test("singular and plural", () => {
        const one = { type: QuestType.RECORD_TRACK, vehicle: Vehicle.FOOT, maxProgress: 1 };
        expect(questText(one, response("en"))).toBe("Record 1 track on foot");
        expect(questText({ ...one, maxProgress: 5 }, response("en"))).toBe("Record 5 tracks on foot");
    });
});
