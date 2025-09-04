import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated } from "../utils";

const router = express.Router();

// Send Friend Request 
router.post("/request", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        await prisma.friendRequest.create({
            data: {
                senderId: (request.user as User).id,
                receiverId: parseInt(sanitizedParams.id)
            }
        });
        response.send(response.__("friend.success.send"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Accept Friend Request
router.put("/request", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        await prisma.friendRequest.updateMany({
            where: {
                senderId: parseInt(sanitizedParams.id),
                receiverId: (request.user as User).id
            },
            data: {
                status: true
            }
        });
        response.send(response.__("friend.success.accept"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Refuse Friend Request
router.patch("/request", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        await prisma.friendRequest.deleteMany({
            where: {
                senderId: parseInt(sanitizedParams.id),
                receiverId: (request.user as User).id
            }
        });
        response.send(response.__("friend.success.refuse"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Remove Friend
router.delete("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        await prisma.friendRequest.deleteMany({
            where: {
                OR: [
                    { senderId: (request.user as User).id, receiverId: parseInt(sanitizedParams.id) },
                    { senderId: parseInt(sanitizedParams.id), receiverId: (request.user as User).id }
                ]
            }
        });
        response.send(response.__("friend.success.remove"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// List Friend Reqeusts
router.get("/request", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const friendRequests = await prisma.friendRequest.findMany({
            where: {
                receiverId: (request.user as User).id,
                status: false
            }
        });
        response.send(friendRequests);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// List Friend Reqeusts
router.get("/request/sent", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const friendRequests = await prisma.friendRequest.findMany({
            where: {
                senderId: (request.user as User).id,
                status: false
            },
            include: {
                sender: true
            }
        });
        response.send(friendRequests);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// List Friends
router.get("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response
                .status(422)
                .send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const friendRequests = await prisma.friendRequest.findMany({
            where: {
                status: true,
                OR: [
                    { senderId: parseInt(sanitizedParams.id) },
                    { receiverId: parseInt(sanitizedParams.id) }
                ],
            },
            include: {
                sender: true,
                receiver: true,
            },
        });

        const friends = friendRequests.map(req =>
            req.senderId == parseInt(sanitizedParams.id) ? req.receiver : req.sender
        );

        return response.status(200).send(friends);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
});

export default router;

