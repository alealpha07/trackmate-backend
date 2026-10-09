import { QuestType, Vehicle } from "@prisma/client";

export const QUESTS_PER_VEHICLE = 2;

// A day's distances differ a lot by vehicle, so each has its own steps; the XP follows the step, not the km
const DISTANCE_STEPS: Record<Vehicle, number[]> = {
    CAR: [50, 100, 200, 500],
    MOTORCYCLE: [50, 100, 200, 400],
    BICYCLE: [5, 10, 20, 50],
    FOOT: [2, 5, 10, 20],
};
const DISTANCE_EXPERIENCE = [100, 200, 400, 1000];
const NAVIGATE_STEPS = [3, 5, 10, 20];
const RECORD_STEPS = [1, 5, 10, 15];

const DISTANCE_TEXT: Record<Vehicle, (km: number) => string> = {
    CAR: (km) => `Drive ${km} km by car`,
    MOTORCYCLE: (km) => `Ride ${km} km by motorcycle`,
    BICYCLE: (km) => `Ride ${km} km by bicycle`,
    FOOT: (km) => `Walk ${km} km`,
};
const VEHICLE_TEXT: Record<Vehicle, string> = {
    CAR: "by car",
    MOTORCYCLE: "by motorcycle",
    BICYCLE: "by bicycle",
    FOOT: "on foot",
};

export interface QuestTemplate {
    description: string;
    experience: number;
    maxProgress: number;
    type: QuestType;
    vehicle: Vehicle;
}

function tracks(count: number) {
    return `${count} ${count === 1 ? "track" : "tracks"}`;
}

export function questPool(vehicle: Vehicle): QuestTemplate[] {
    return [
        ...DISTANCE_STEPS[vehicle].map((km, step) => ({
            description: DISTANCE_TEXT[vehicle](km),
            experience: DISTANCE_EXPERIENCE[step],
            maxProgress: km,
            type: QuestType.TRAVEL_DISTANCE,
            vehicle,
        })),
        ...NAVIGATE_STEPS.map((count) => ({
            description: `Navigate ${tracks(count)} ${VEHICLE_TEXT[vehicle]}`,
            experience: count * 25,
            maxProgress: count,
            type: QuestType.NAVIGATE_TRACK,
            vehicle,
        })),
        ...RECORD_STEPS.map((count) => ({
            description: `Record ${tracks(count)} ${VEHICLE_TEXT[vehicle]}`,
            experience: count * 30,
            maxProgress: count,
            type: QuestType.RECORD_TRACK,
            vehicle,
        })),
    ];
}

/** Random quests for each vehicle, of different types so a day isn't two of the same task. */
export function dailyQuests(vehicles: Vehicle[]): QuestTemplate[] {
    return vehicles.flatMap((vehicle) => {
        const shuffled = [...questPool(vehicle)].sort(() => Math.random() - 0.5);
        const picked: QuestTemplate[] = [];
        for (const quest of shuffled) {
            if (picked.length === QUESTS_PER_VEHICLE) break;
            if (!picked.some((p) => p.type === quest.type)) picked.push(quest);
        }
        return picked;
    });
}
