import { Vehicle } from "@prisma/client";

export type VehicleClass = "motor" | "bicycle" | "foot";

export interface VehicleConfig {
    // lower case database value
    id: string;
    class: VehicleClass;
    plannable: boolean;
    costing: string;
}

export const VEHICLES: VehicleConfig[] = [
    { id: "car", class: "motor", plannable: false, costing: "auto" },
    { id: "motorcycle", class: "motor", plannable: false, costing: "motorcycle" },
    { id: "bicycle", class: "bicycle", plannable: true, costing: "bicycle" },
    { id: "foot", class: "foot", plannable: false, costing: "pedestrian" },
];

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

export function vehicleCosting(vehicle: Vehicle): string {
    return VEHICLES.find((v) => v.id === vehicleId(vehicle))!.costing;
}

export function isPlannable(id: unknown): boolean {
    return VEHICLES.some((v) => v.id === id && v.plannable);
}
