import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated } from "../utils";
import { parseVehicle, vehicleId } from "../vehicles";

const MAX_EXP_PER_LEVEL = 1000;
const router = express.Router();

// Quest Increase
router.post("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["type", "progress", "vehicle"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        const vehicle = parseVehicle(sanitizedParams.vehicle);
        if (vehicle === null) {
            return response.status(422).send(response.__("track.errors.vehicle"));
        }
        // Quests are per vehicle: a bicycle travel advances only the bicycle quests
        const quests = await prisma.quest.findMany({ where: { userId: (request.user as User).id, type: sanitizedParams.type, vehicle } });
        
        for (const quest of quests) {
            await prisma.quest.update({
                where: { id: quest.id },
                data: {
                    progress: quest.progress + parseInt(sanitizedParams.progress)
                }
            });
        }
        response.send(response.__("quest.success.update"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Quest Collect
router.put("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        // Only the user's own quests: anyone else's would give them its experience
        const quest = await prisma.quest.findFirst({ where: { id: sanitizedParams.id, userId: (request.user as User).id } });

        if (!quest) {
            return response.send(response.__("quest.errors.missing"));
        }

        if (quest.progress < quest.maxProgress) {
            return response.send(response.__("quest.errors.uncompleted"));
        }

        let user = await prisma.user.findUnique({ where: { id: (request.user as User).id } });

        if (!user || user == undefined) {
            return response.send(response.__("user.errors.missing"));
        }

        const level = user.experience + quest.experience > MAX_EXP_PER_LEVEL ? user.level + 1 : user.level;
        const experience = user.experience + quest.experience > MAX_EXP_PER_LEVEL ? 0 : user.experience + quest.experience;

        await prisma.user.update({
            where: { id: (request.user as User).id },
            data: {
                level: level,
                experience: experience
            }
        });

        await prisma.quest.delete({ where: { id: quest.id } });

        response.send(response.__("quest.success.collect"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})


// Quest Get
router.get("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const quests = await prisma.quest.findMany({ where: { userId: (request.user as User).id } });

        response.send(quests.map((quest) => ({ ...quest, vehicle: vehicleId(quest.vehicle) })));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

export default router;
