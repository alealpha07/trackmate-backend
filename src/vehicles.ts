import { Vehicle } from "@prisma/client";

/** A track can be travelled by any vehicle of its class. */
export type VehicleClass = "motor" | "bicycle" | "foot";

export interface VehicleConfig {
    /** In the API: the database value in lower case. */
    id: string;
    class: VehicleClass;
    /** Our planner can route it. */
    plannable: boolean;
}

export const VEHICLES: VehicleConfig[] = [
    { id: "car", class: "motor", plannable: false },
    { id: "motorcycle", class: "motor", plannable: false },
    { id: "bicycle", class: "bicycle", plannable: true },
    { id: "foot", class: "foot", plannable: false },
];

/** null when not a vehicle id. */
export function parseVehicle(value: unknown): Vehicle | null {
    if (typeof value !== "string") return null;
    const vehicle = value.toUpperCase() as Vehicle;
    return Object.values(Vehicle).includes(vehicle) ? vehicle : null;
}

export function vehicleId(vehicle: Vehicle): string {
    return vehicle.toLowerCase();
}

export function vehicleClass(vehicle: Vehicle): VehicleClass {
    return VEHICLES.find((v) => v.id === vehicleId(vehicle))!.class;
}

export function isPlannable(id: unknown): boolean {
    return VEHICLES.some((v) => v.id === id && v.plannable);
}
