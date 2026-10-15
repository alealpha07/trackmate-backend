import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated, parseId, sendInvalidId, PUBLIC_USER } from "../utils";

const router = express.Router();

// Send Friend Request 
router.post("/request", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const senderId = (request.user as User).id;
        const receiverId = parseId(sanitizedParams.id);
        if (!receiverId) {
            return sendInvalidId(response);
        }
        if (receiverId === senderId) {
            return response.status(422).send(response.__("friend.errors.self"));
        }
        if (!(await prisma.user.findUnique({ where: { id: receiverId }, select: { id: true } }))) {
            return response.status(404).send(response.__("user.errors.missing"));
        }
        const existing = await prisma.friendRequest.findFirst({
            where: { OR: [{ senderId, receiverId }, { senderId: receiverId, receiverId: senderId }] }
        });
        if (existing) {
            return response.status(409).send(response.__("friend.errors.exists"));
        }

        await prisma.friendRequest.create({ data: { senderId, receiverId } });
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

        const senderId = parseId(sanitizedParams.id);
        if (!senderId) {
            return sendInvalidId(response);
        }

        await prisma.friendRequest.updateMany({
            where: {
                senderId,
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

        const senderId = parseId(sanitizedParams.id);
        if (!senderId) {
            return sendInvalidId(response);
        }

        await prisma.friendRequest.deleteMany({
            where: {
                senderId,
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

        const friendId = parseId(sanitizedParams.id);
        if (!friendId) {
            return sendInvalidId(response);
        }

        await prisma.friendRequest.deleteMany({
            where: {
                OR: [
                    { senderId: (request.user as User).id, receiverId: friendId },
                    { senderId: friendId, receiverId: (request.user as User).id }
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
                sender: { select: PUBLIC_USER }
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

        const userId = parseId(sanitizedParams.id);
        if (!userId) {
            return sendInvalidId(response);
        }
        const me = (request.user as User).id;
        if (userId !== me) {
            const friendship = await prisma.friendRequest.findFirst({
                where: { status: true, OR: [{ senderId: me, receiverId: userId }, { senderId: userId, receiverId: me }] }
            });
            if (!friendship) {
                return response.status(403).send(response.__("friend.errors.not-friend"));
            }
        }

        const friendRequests = await prisma.friendRequest.findMany({
            where: {
                status: true,
                OR: [
                    { senderId: userId },
                    { receiverId: userId }
                ],
            },
            include: {
                sender: { select: PUBLIC_USER },
                receiver: { select: PUBLIC_USER },
            },
        });

        const friends = friendRequests.map(req =>
            req.senderId == userId ? req.receiver : req.sender
        );

        return response.status(200).send(friends);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
});

export default router;

