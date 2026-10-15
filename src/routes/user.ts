import express, { NextFunction, Request, Response } from "express";
import { User } from "../generated/prisma/client.js";
import { sanitizeParams, prisma, isAuthenticated, parseId, sendInvalidId, PUBLIC_USER, deleteUserSessions } from "../utils.js";
import { postImageFiles, profileImageFile, removeFiles, removeTrackFiles, trackFile, travelFile } from "../files.js";
import { checkPassword } from "../passportConfig.js";
import { fileLimit, passwordLimit } from "../limits.js";
import multer from "multer"
import path from "path"
import fs from "fs";
import sharp from "sharp";
import { ZipArchive } from "archiver";
import { parseVehicle, VEHICLES, vehicleId } from "../vehicles.js";

const router = express.Router();
const MAX_BIO_LENGTH = 500;

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
        }
    },
});

// Upload Profile Image
router.post("/image", isAuthenticated, fileLimit, upload.single("file"), async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.file) {
            return res.status(422).json(res.__("file.errors.missing"));
        }

        const userId = (req.user as User).id
        const outputPath = profileImageFile(userId);

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

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

        const userId = parseId(sanitizedParams.id);
        if (!userId) {
            return sendInvalidId(res);
        }
        const filePath = profileImageFile(userId);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json(res.__("file.errors.missing"));
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Delete Profile Image
router.delete("/image", isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        const filePath = profileImageFile((req.user as User).id);
        if (!fs.existsSync(filePath)) {
            return res.status(404).send(res.__("file.errors.missing"));
        }
        removeFiles([filePath]);
        res.send(res.__("file.success.delete"));
    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Edit Profile
router.put("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        // empty bio is allowed
        const bio = request.body?.bio;
        if (typeof bio !== "string") {
            return response.status(422).send(response.__("server.missing-params") + response.__("bio"));
        }
        if (bio.length > MAX_BIO_LENGTH) {
            return response.status(422).send(response.__("user.errors.bio-long", String(MAX_BIO_LENGTH)));
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

// Get User Vehicles
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

// Edit User Vehicles
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

        const id = parseId(sanitizedParams.id);
        if (!id) {
            return sendInvalidId(response);
        }

        const userData = await prisma.user.findUnique({
            where: { id },
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

// Download all of the user's data as a zip
router.get("/export", isAuthenticated, fileLimit, async (request: Request, response: Response, next: NextFunction): Promise<any> => {
    try {
        const userId = (request.user as User).id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                ...PUBLIC_USER,
                termsAcceptedAt: true,
                vehicles: { select: { vehicle: true } },
                quests: true,
                tracks: { include: { posts: true } },
                travels: { include: { Track: { select: { name: true } } } },
                likes: { select: { postId: true } },
                saves: { select: { postId: true } },
                sentFriendRequests: { include: { receiver: { select: { username: true } } } },
                receivedFriendRequests: { include: { sender: { select: { username: true } } } },
            },
        });
        if (!user) {
            return response.status(404).send(response.__("user.errors.missing"));
        }

        const { vehicles, quests, tracks, travels, likes, saves, sentFriendRequests, receivedFriendRequests, ...profile } = user;
        const data = {
            exportedAt: new Date().toISOString(),
            profile,
            vehicles: vehicles.map((v) => vehicleId(v.vehicle)),
            quests: quests.map(({ userId, ...quest }) => ({ ...quest, vehicle: vehicleId(quest.vehicle) })),
            friends: [
                ...sentFriendRequests.map((r) => ({ username: r.receiver.username, accepted: r.status, sentByMe: true })),
                ...receivedFriendRequests.map((r) => ({ username: r.sender.username, accepted: r.status, sentByMe: false })),
            ],
            tracks: tracks.map(({ posts, userId, ...track }) => ({ ...track, vehicle: vehicleId(track.vehicle) })),
            travels: travels.map(({ Track, userId, ...travel }) => ({ ...travel, vehicle: vehicleId(travel.vehicle), trackName: Track?.name ?? null })),
            posts: tracks.flatMap((track) => track.posts),
            likedPostIds: likes.map((like) => like.postId),
            savedPostIds: saves.map((save) => save.postId),
        };

        const archive = new ZipArchive();
        archive.on("error", next);
        response.attachment(`trackmate-${user.username}.zip`);
        archive.pipe(response);
        archive.append(JSON.stringify(data, null, 4), { name: "data.json" });
        const addFile = (file: string, name: string) => {
            if (fs.existsSync(file)) archive.file(file, { name });
        };
        addFile(profileImageFile(userId), "profile.jpg");
        for (const track of tracks) {
            addFile(trackFile(track.id), `tracks/${track.id}.json`);
            for (const post of track.posts) {
                for (const file of postImageFiles(post.id)) addFile(file, `posts/${path.basename(file)}`);
            }
        }
        for (const travel of travels) addFile(travelFile(travel.id), `travels/${travel.id}.json`);
        await archive.finalize();
    } catch (error) {
        if (response.headersSent) return next(error);
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Delete the account and everything in it
router.delete("/", isAuthenticated, passwordLimit, async (request: Request, response: Response, next: NextFunction): Promise<any> => {
    try {
        const userId = (request.user as User).id;
        if (!(await checkPassword(userId, request.body?.password))) {
            return response.status(403).send(response.__("auth.errors.wrong-password"));
        }

        const tracks = await prisma.track.findMany({ where: { userId }, select: { id: true, posts: { select: { id: true } } } });
        const travels = await prisma.travel.findMany({ where: { userId }, select: { id: true } });
        // the rest cascades; other users' travels on these tracks stay without a track
        await prisma.user.delete({ where: { id: userId } });

        removeFiles([profileImageFile(userId), ...travels.map((travel) => travelFile(travel.id))]);
        for (const track of tracks) removeTrackFiles(track.id, track.posts.map((post) => post.id));
        await deleteUserSessions(userId);
        request.session.destroy((error) => {
            if (error) return next(error);
            response.clearCookie("connect.sid").send(response.__("user.success.delete"));
        });
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

export default router;

