import express, { Request, Response } from "express";
import { User, Vehicle } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated, parseId, sendInvalidId, canSeeRoute } from "../utils";
import { removeFiles, removeTrackFiles, trackFile, travelFile } from "../files";
import { fileLimit, instructionsLimit } from "../limits";
import { parseVehicle, vehicleClass, vehicleCosting, vehicleId } from "../vehicles";
import { InstructionsError, trackInstructions, trackPoints, valhallaLanguage } from "../routing/instructions";
import multer from "multer"
import path from "path"
import fs from "fs";

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
// a day of recording at one point a second
const MAX_TRACK_POINTS = 100_000;

function vehicleFilter(query: any): Vehicle | undefined | null {
    if (query.vehicle === undefined || query.vehicle === "") return undefined;
    return parseVehicle(query.vehicle);
}

// the app and the planner both write { track: [{ lat, lng, ... }] }
function isTrackFile(buffer: Buffer): boolean {
    let file: any;
    try {
        file = JSON.parse(buffer.toString("utf-8"));
    } catch {
        return false;
    }
    const points = file?.track;
    return Array.isArray(points) && points.length <= MAX_TRACK_POINTS && points.every((point: any) =>
        typeof point?.lat === "number" && Math.abs(point.lat) <= 90 &&
        typeof point?.lng === "number" && Math.abs(point.lng) <= 180
    );
}

// sends the error itself when the track is missing or hidden from this user
async function findVisibleTrack(response: Response, rawId: unknown, userId: number) {
    const id = parseId(rawId);
    if (!id) {
        sendInvalidId(response);
        return null;
    }
    const track = await prisma.track.findUnique({ where: { id } });
    if (!track) {
        response.status(404).send(response.__("track.errors.missing"));
        return null;
    }
    if (!(await canSeeRoute(userId, track.id))) {
        response.status(403).send(response.__("track.errors.hidden"));
        return null;
    }
    return track;
}

function writeUpload(file: string, buffer: Buffer) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
}

// Upload track JSON
router.post("/file", isAuthenticated, fileLimit, upload.single("file"), async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.file) {
            return res.status(422).send(res.__("file.errors.missing"));
        }

        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);
        if (missingParams.length > 0) {
            return res.status(422).send(
                res.__("server.missing-params") +
                missingParams.map((p) => res.__(p)).join(", ")
            );
        }

        const trackId = parseId(sanitizedParams.id);
        if (!trackId) {
            return sendInvalidId(res);
        }
        const track = await prisma.track.findUnique({ where: { id: trackId } });
        if (!track) {
            return res.status(404).send(res.__("track.errors.missing"));
        }
        if (track.userId !== (req.user as User).id) {
            return res.status(403).send(res.__("track.errors.not-owner"));
        }
        if (!isTrackFile(req.file.buffer)) {
            return res.status(422).send(res.__("track.errors.file"));
        }

        writeUpload(trackFile(trackId), req.file.buffer);

        res.send(res.__("file.success.upload"));
    } catch (error: any) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Get Track JSON
router.get("/file", isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);
        if (missingParams.length > 0) {
            return res.status(422).send(
                res.__("server.missing-params") +
                missingParams.map((p) => res.__(p)).join(", ")
            );
        }

        const track = await findVisibleTrack(res, sanitizedParams.id, (req.user as User).id);
        if (!track) return;
        const filePath = trackFile(track.id);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send(res.__("file.errors.missing"));
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Turn-by-turn instructions
router.get("/instructions", isAuthenticated, instructionsLimit, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const track = await findVisibleTrack(response, sanitizedParams.id, (request.user as User).id);
        if (!track) return;
        let vehicle = track.vehicle;
        if (request.query.vehicle !== undefined) {
            const requested = parseVehicle(request.query.vehicle);
            if (!requested) {
                return response.status(422).send(response.__("track.errors.vehicle"));
            }
            if (vehicleClass(requested) !== vehicleClass(track.vehicle)) {
                return response.status(422).send(response.__("track.errors.vehicle-class"));
            }
            vehicle = requested;
        }

        const filePath = trackFile(track.id);
        let points;
        try {
            points = trackPoints(JSON.parse(await fs.promises.readFile(filePath, "utf-8")));
        } catch {
            points = null;
        }
        if (!points) {
            return response.status(404).send(response.__("file.errors.missing"));
        }

        const language = valhallaLanguage(request.query.lang);
        try {
            const instructions = await trackInstructions({
                trackId: track.id,
                points,
                costing: vehicleCosting(vehicle),
                language,
                speedLimits: vehicleClass(vehicle) === "motor",
            });
            response.json({ vehicle: vehicleId(vehicle), language, ...instructions });
        } catch (error) {
            if (!(error instanceof InstructionsError)) throw error;
            console.error(`Track ${track.id}: ${error.message}`);
            const failure = {
                "no-match": [422, "route.errors.instructions-no-match"],
                "too-long": [422, "route.errors.instructions-too-long"],
                timeout: [504, "route.errors.instructions-timeout"],
                unavailable: [502, "route.errors.instructions"],
            } as const;
            const [status, message] = failure[error.kind];
            response.status(status).send(response.__(message));
        }
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Create Track
router.post("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["name", "vehicle"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        const vehicle = parseVehicle(sanitizedParams.vehicle);
        if (!vehicle) {
            return response.status(422).send(response.__("track.errors.vehicle"));
        }

        const track = await prisma.track.create({
            data: {
                userId: (request.user as User).id,
                name: sanitizedParams.name,
                vehicle
            }
        });
        response.send({id : track.id});
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Save travel
router.post("/travel", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id", "time", "averageSpeed", "maxSpeed", "distance"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const track = await findVisibleTrack(response, sanitizedParams.id, (request.user as User).id);
        if (!track) return;
        let vehicle = track.vehicle;
        if (request.body.vehicle != null) {
            const requested = parseVehicle(request.body.vehicle);
            if (!requested) {
                return response.status(422).send(response.__("track.errors.vehicle"));
            }
            if (vehicleClass(requested) !== vehicleClass(track.vehicle)) {
                return response.status(422).send(response.__("track.errors.vehicle-class"));
            }
            vehicle = requested;
        }

        const travel = await prisma.travel.create({
            data: {
                userId: (request.user as User).id,
                trackId: track.id,
                vehicle,
                time: sanitizedParams.time,
                averageSpeed: sanitizedParams.averageSpeed,
                maxSpeed: sanitizedParams.maxSpeed,
                distance: sanitizedParams.distance,
                dateTime: new Date()
            }
        });
        response.json({ id: travel.id, message: response.__("track.success.travel") });
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Upload travel points (with per-point speed)
router.post("/travel/file", isAuthenticated, fileLimit, upload.single("file"), async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.file) {
            return res.status(422).send(res.__("file.errors.missing"));
        }

        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);
        if (missingParams.length > 0) {
            return res.status(422).send(
                res.__("server.missing-params") +
                missingParams.map((p) => res.__(p)).join(", ")
            );
        }

        const travelId = parseId(sanitizedParams.id);
        if (!travelId) {
            return sendInvalidId(res);
        }
        const travel = await prisma.travel.findUnique({ where: { id: travelId } });
        if (!travel) {
            return res.status(404).send(res.__("track.errors.travel-missing"));
        }
        if (travel.userId !== (req.user as User).id) {
            return res.status(403).send(res.__("track.errors.travel-not-owner"));
        }
        if (!isTrackFile(req.file.buffer)) {
            return res.status(422).send(res.__("track.errors.file"));
        }

        writeUpload(travelFile(travelId), req.file.buffer);

        res.send(res.__("file.success.upload"));
    } catch (error: any) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Get travel points
router.get("/travel/file", isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);
        if (missingParams.length > 0) {
            return res.status(422).send(
                res.__("server.missing-params") +
                missingParams.map((p) => res.__(p)).join(", ")
            );
        }

        const travelId = parseId(sanitizedParams.id);
        if (!travelId) {
            return sendInvalidId(res);
        }
        const travel = await prisma.travel.findUnique({ where: { id: travelId } });
        if (!travel) {
            return res.status(404).send(res.__("track.errors.travel-missing"));
        }
        const userId = (req.user as User).id;
        if (travel.userId !== userId && !(travel.trackId && await canSeeRoute(userId, travel.trackId))) {
            return res.status(403).send(res.__("track.errors.hidden"));
        }
        const filePath = travelFile(travel.id);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send(res.__("file.errors.missing"));
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Delete travel
router.delete("/travel", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        const travelId = parseId(sanitizedParams.id);
        if (!travelId) {
            return sendInvalidId(response);
        }

        const travel = await prisma.travel.findUnique({ where: { id: travelId } });
        if (!travel) {
            return response.status(404).send(response.__("track.errors.travel-missing"));
        }
        if (travel.userId !== (request.user as User).id) {
            return response.status(403).send(response.__("track.errors.travel-not-owner"));
        }
        await prisma.travel.delete({ where: { id: travel.id } });
        removeFiles([travelFile(travel.id)]);
        response.send(response.__("track.success.travel-delete"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get travels
router.get("/travel", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const travels = await prisma.travel.findMany({
            where: {
                userId: (request.user as User).id
            },
            orderBy: {
                dateTime: "desc"
            },
            include: {
                Track: {
                    select: {
                        name: true
                    }
                }
            }
        });
        response.send(travels.map((t) => {
            return {
                ...t,
                vehicle: vehicleId(t.vehicle),
                dateTimeString: t.dateTime.toLocaleDateString('it-IT'),
                name: t.Track?.name || "unknown"
            }
        }));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get travels
router.get("/travel/details", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const vehicle = vehicleFilter(request.query);
        if (vehicle === null) {
            return response.status(422).send(response.__("track.errors.vehicle"));
        }
        const track = await findVisibleTrack(response, sanitizedParams.id, (request.user as User).id);
        if (!track) return;

        const travels = await prisma.travel.findMany({
            where: {
                trackId: track.id,
                vehicle
            },
            include: {
                Track: {
                    select: {
                        name: true
                    }
                },
                User: {
                    select: {
                        username: true
                    }
                }
            }
        });
        response.send(travels.map((t) => {
            return {
                ...t,
                vehicle: vehicleId(t.vehicle),
                dateTimeString: t.dateTime.toLocaleDateString('it-IT'),
                name: t.Track?.name || "unknown",
                username: t.User?.username || "unknown"
            }
        }));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get leaderboard
router.get(
  "/leaderboard",
  isAuthenticated,
  async (request: Request, response: Response): Promise<any> => {
    try {
      const requiredParams = ["id"];
      const { sanitizedParams, missingParams } = sanitizeParams(
        requiredParams,
        request.query
      );
      if (missingParams.length > 0) {
        return response
          .status(422)
          .send(
            response.__("server.missing-params") +
              missingParams.map((p) => response.__(p)).join(", ")
          );
      }

      const vehicle = vehicleFilter(request.query);
      if (vehicle === null) {
        return response.status(422).send(response.__("track.errors.vehicle"));
      }
      const track = await findVisibleTrack(response, sanitizedParams.id, (request.user as User).id);
      if (!track) return;
      const trackId = track.id;

      const leaderboard = await prisma.travel.groupBy({
        by: ["userId"],
        where: {
          trackId: trackId,
          vehicle,
        },
        _min: {
          time: true,
        },
        orderBy: {
          _min: {
            time: "asc",
          },
        },
        take: 10,
      });

      const userIds = leaderboard.map((entry) => entry.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true },
      });

      const userMap = new Map(users.map((u) => [u.id, u.username]));

      const formattedLeaderboard = leaderboard.map((record) => ({
        userId: record.userId,
        name: userMap.get(record.userId) ?? "Unknown",
        time: record._min.time,
      }));

      response.send(formattedLeaderboard);
    } catch (error) {
      response.status(500).send(response.__("server.error"));
      console.error(error);
    }
  }
);


// Edit Track
router.put("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id", "name"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        const trackId = parseId(sanitizedParams.id);
        if (!trackId) {
            return sendInvalidId(response);
        }
        const userId = (request.user as User).id;
        const vehicle = request.body.vehicle == null ? undefined : parseVehicle(request.body.vehicle);
        if (vehicle === null) {
            return response.status(422).send(response.__("track.errors.vehicle"));
        }

        // in a transaction so no other travel slips in
        const error = await prisma.$transaction(async (tx) => {
            const track = await tx.track.findUnique({ where: { id: trackId } });
            if (!track) return { status: 404, key: "track.errors.missing" };
            if (track.userId !== userId) return { status: 403, key: "track.errors.not-owner" };

            if (vehicle && vehicleClass(vehicle) !== vehicleClass(track.vehicle)) {
                const othersTravels = await tx.travel.count({ where: { trackId: track.id, userId: { not: userId } } });
                if (othersTravels > 0) return { status: 409, key: "track.errors.vehicle-class-locked" };
                // only the owner's travels are left, move them to the new vehicle
                await tx.travel.updateMany({ where: { trackId: track.id }, data: { vehicle } });
            }
            await tx.track.update({
                where: { id: track.id },
                data: { name: sanitizedParams.name, vehicle }
            });
            return null;
        });
        if (error) {
            return response.status(error.status).send(response.__(error.key));
        }
        response.send(response.__("track.success.update"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Delete Track
router.delete("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const trackId = parseId(sanitizedParams.id);
        if (!trackId) {
            return sendInvalidId(response);
        }
        const track = await prisma.track.findUnique({ where: { id: trackId }, include: { posts: { select: { id: true } } } });
        if (!track) {
            return response.status(404).send(response.__("track.errors.missing"));
        }
        if (track.userId !== (request.user as User).id) {
            return response.status(403).send(response.__("track.errors.not-owner"));
        }

        // posts go with the track, other users' travels stay without it
        await prisma.track.delete({ where: { id: track.id } });
        removeTrackFiles(track.id, track.posts.map((post) => post.id));
        response.send(response.__("track.success.delete"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get Tracks and Best Performance Stats
router.get("/", isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req.user as User).id;
        const vehicle = vehicleFilter(req.query);
        if (vehicle === null) {
            return res.status(422).send(res.__("track.errors.vehicle"));
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                tracks: {
                    include: {
                        travels: {
                            where: { vehicle },
                            select: {
                                time: true,
                                maxSpeed: true,
                                averageSpeed: true
                            }
                        }
                    }
                }
            }
        });

        if (!user) {
            return res.status(404).send(res.__("user.errors.missing"));
        }

        const tracks = user.tracks.map(track => {
            if (track.travels.length === 0) {
                return {
                    id: track.id,
                    name: track.name,
                    vehicle: vehicleId(track.vehicle),
                    bestTime: null,
                    maxSpeed: null,
                    bestAverageSpeed: null,
                    travelCount: 0
                };
            }

            const bestTime = parseFloat(Math.min(...track.travels.map(t => t.time)).toFixed(2));
            const maxSpeed = parseFloat(Math.max(...track.travels.map(t => t.maxSpeed)).toFixed(2));
            const bestAverageSpeed = parseFloat(Math.max(...track.travels.map(t => t.averageSpeed)).toFixed(2));

            return {
                id: track.id,
                name: track.name,
                vehicle: vehicleId(track.vehicle),
                bestTime,
                maxSpeed,
                bestAverageSpeed,
                travelCount: track.travels.length
            };
        });

        res.json(tracks);
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__("server.error"));
    }
});

// Get One Track + Best Travel Performances
router.get("/details", isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);

        if (missingParams.length > 0) {
            return res
                .status(422)
                .send(res.__("server.missing-params") + missingParams.map((p) => res.__(p)).join(", "));
        }

        const vehicle = vehicleFilter(req.query);
        if (vehicle === null) {
            return res.status(422).send(res.__("track.errors.vehicle"));
        }

        const visible = await findVisibleTrack(res, sanitizedParams.id, (req.user as User).id);
        if (!visible) return;
        const track = await prisma.track.findUnique({
            where: { id: visible.id },
            include: {
                travels: { where: { vehicle } }
            }
        });

        if (!track) {
            return res.status(404).send(res.__("track.errors.missing"));
        }

        const userBestTravel = await prisma.travel.findFirst({
            where: { trackId: track.id, userId: (req.user as User).id, vehicle },
            orderBy: { time: "asc" },
            select: {
                id: true,
                vehicle: true,
                time: true,
                maxSpeed: true,
                distance: true,
                averageSpeed: true,
                userId: true,
                User: {
                    select: { username: true },
                },
            },
        });

        const overallBestTravel = await prisma.travel.findFirst({
            where: { trackId: track.id, vehicle },
            orderBy: { time: "asc" },
            select: {
                id: true,
                vehicle: true,
                time: true,
                distance: true,
                maxSpeed: true,
                averageSpeed: true,
                userId: true,
                User: {
                    select: { username: true },
                },
            },
        });

        const formatStats = (travel: typeof userBestTravel | null) => {
            if (!travel) return null;
            return {
                id: travel.id,
                userId: travel.userId,
                time: parseFloat(travel.time.toFixed(2)),
                maxSpeed: parseFloat(travel.maxSpeed.toFixed(2)),
                averageSpeed: parseFloat(travel.averageSpeed.toFixed(2)),
                username: travel.User.username,
                distance: travel.distance,
                vehicle: vehicleId(travel.vehicle)
            };
        };

        res.json({
            id: track.id,
            name: track.name,
            vehicle: vehicleId(track.vehicle),
            ownerId: track.userId,
            userBest: formatStats(userBestTravel),
            overallBest: formatStats(overallBestTravel),
            travelCount: track.travels.filter((t) => t.userId == (req.user as User).id).length
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__("server.error"));
    }
});





export default router;
