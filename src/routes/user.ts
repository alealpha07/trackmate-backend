import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated, UPLOAD_DIR } from "../utils";
import multer from "multer"
import path from "path"
import fs from "fs";
import sharp from "sharp";
import { parseVehicle, VEHICLES, vehicleId } from "../vehicles";

const router = express.Router();
const FINAL_UPLOAD_DIR = path.join(UPLOAD_DIR, "profile");

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed"));
        }
    },
});

// Upload Profile Image
router.post("/image", upload.single("file"), isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.file) {
            return res.status(422).json(res.__("file.errors.missing"));
        }

        const userId = (req.user as User).id
        const outputPath = path.join(FINAL_UPLOAD_DIR, `${userId}.jpg`);

        // Ensure the directory exists
        fs.mkdirSync(FINAL_UPLOAD_DIR, { recursive: true });

        // Convert and save image as JPG using sharp
        await sharp(req.file.buffer)
            .resize(512, 512, { fit: "cover" })
            .jpeg({ quality: 90 })
            .toFile(outputPath);

        res.json(res.__("file.success.upload"));
    } catch (error: any) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Get User Profile Image
router.get("/image", isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);
        if (missingParams.length > 0) {
            return res.status(422).send(
                res.__("server.missing-params") +
                missingParams.map((p) => res.__(p)).join(", ")
            );
        }

        const userId = sanitizedParams.id;
        const filePath = path.join(FINAL_UPLOAD_DIR, `${userId}.jpg`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json(res.__("file.errors.missing"));
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Edit Profile
router.put("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        // An empty bio is allowed: users start with one, so it must be possible to save it unchanged
        const bio = request.body.bio;
        if (typeof bio !== "string") {
            return response.status(422).send(response.__("server.missing-params") + response.__("bio"));
        }

        await prisma.user.update({
            where: { id: (request.user as User).id }, data: {
                bio
            }
        });
        response.send(response.__("user.success.update"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get the vehicles in the user's profile, in the order of GET /vehicle
router.get("/vehicles", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const vehicles = await prisma.userVehicle.findMany({ where: { userId: (request.user as User).id } });
        const ids = vehicles.map((v) => vehicleId(v.vehicle));
        response.json(VEHICLES.map((v) => v.id).filter((id) => ids.includes(id)));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Edit the vehicles in the user's profile: the next daily quests follow them
router.put("/vehicles", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["vehicles"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        if (!Array.isArray(sanitizedParams.vehicles)) {
            return response.status(422).send(response.__("user.errors.vehicle"));
        }
        const vehicles = (sanitizedParams.vehicles as unknown[]).map(parseVehicle);
        if (vehicles.some((v) => v === null)) {
            return response.status(422).send(response.__("user.errors.vehicle"));
        }
        if (vehicles.length === 0) {
            return response.status(422).send(response.__("user.errors.no-vehicles"));
        }

        const userId = (request.user as User).id;
        await prisma.$transaction([
            prisma.userVehicle.deleteMany({ where: { userId } }),
            prisma.userVehicle.createMany({ data: [...new Set(vehicles)].map((vehicle) => ({ userId, vehicle: vehicle! })) }),
        ]);
        response.send(response.__("user.success.vehicles"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get User details
router.get("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const userData = await prisma.user.findUnique({
            where: { id: parseInt(sanitizedParams.id)},
            include: {
                travels: {
                    select: {
                        distance: true
                    }
                },
                sentFriendRequests: {
                    where: { status: true },
                    select: {
                        receiverId: true
                    }
                },
                receivedFriendRequests: {
                    where: { status: true },
                    select: {
                        senderId: true
                    }
                }
            }
        });

        if (userData === null) {
            return response.status(422).send(response.__("user.errors.missing"));
        }

        response.send({
            username: userData.username,
            bio: userData.bio,
            level: userData.level,
            experience: userData.experience,
            friendsNumber: userData.sentFriendRequests.length + userData.receivedFriendRequests.length,
            totalTravelledLength: userData.travels.reduce((sum, travel) => sum + travel.distance, 0)
        });
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

export default router;

