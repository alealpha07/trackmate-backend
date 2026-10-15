import request, { type Response } from "supertest";
import type { Express } from "express";
import { Vehicle } from "../../src/generated/prisma/client.js";
import { hashPassword } from "../../src/passportConfig.js";
import { prisma } from "../../src/utils.js";

export type Client = ReturnType<typeof request.agent>;

export const PASSWORD = "correct-horse-battery";
const SECRET_KEYS = ["password", "termsAcceptedAt"];
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

// bcrypt is slow, so every user shares one hash
let passwordHash: Promise<string> | undefined;

export async function createUser(username: string, vehicles: Vehicle[] = Object.values(Vehicle)) {
    passwordHash ??= hashPassword(PASSWORD);
    return prisma.user.create({
        data: {
            username,
            password: await passwordHash,
            termsAcceptedAt: new Date(),
            vehicles: { create: vehicles.map((vehicle) => ({ vehicle })) },
        },
    });
}

export function noLeaks(response: Response, call: string) {
    if (response.type !== "application/json") return;
    const visit = (value: unknown, where: string): void => {
        if (Array.isArray(value)) return value.forEach((item, i) => visit(item, `${where}[${i}]`));
        if (typeof value !== "object" || value === null) return;
        for (const [key, child] of Object.entries(value)) {
            if (SECRET_KEYS.includes(key)) throw new Error(`${call} sends ${where}.${key}`);
            visit(child, `${where}.${key}`);
        }
    };
    visit(response.body, "body");
}

// every JSON answer is checked for private user fields
export function client(app: Express): Client {
    const agent = request.agent(app);
    for (const method of METHODS) {
        const send = agent[method].bind(agent);
        agent[method] = ((url: string) => send(url).expect((response) => noLeaks(response, `${method.toUpperCase()} ${url}`))) as Client[typeof method];
    }
    return agent;
}

export async function login(app: Express, username: string, password = PASSWORD): Promise<Client> {
    const agent = client(app);
    await agent.post("/auth/login").send({ username, password }).expect(200);
    return agent;
}

export async function signIn(app: Express, username: string, vehicles?: Vehicle[]) {
    const user = await createUser(username, vehicles);
    return { user, agent: await login(app, username) };
}
