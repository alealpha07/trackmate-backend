import express, { Request, Response } from "express";
import { User, Vehicle } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated, UPLOAD_DIR } from "../utils";
import { parseVehicle, vehicleClass, vehicleId } from "../vehicles";
import multer from "multer"
import path from "path"
import fs from "fs";

const router = express.Router();
const FINAL_UPLOAD_DIR = path.join(UPLOAD_DIR, "track");
const TRAVEL_UPLOAD_DIR = path.join(UPLOAD_DIR, "travel");

const storage = multer.memoryStorage();
const upload = multer({ storage });

/** Optional `vehicle` filter on the stats: undefined when absent, null when not a vehicle. */
function vehicleFilter(query: any): Vehicle | undefined | null {
    if (query.vehicle === undefined || query.vehicle === "") return undefined;
    return parseVehicle(query.vehicle);
}

// Upload track JSON
router.post("/file", isAuthenticated, upload.single("file"), async (req: Request, res: Response): Promise<any> => {
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

        const trackId = parseInt(sanitizedParams.id);
        const track = await prisma.track.findUnique({ where: { id: trackId } });
        if (!track) {
            return res.status(404).send(res.__("track.errors.missing"));
        }
        if (track.userId !== (req.user as User).id) {
            return res.status(403).send(res.__("track.errors.not-owner"));
        }

        const outputPath = path.join(FINAL_UPLOAD_DIR, `${trackId}.json`);

        // Ensure the directory exists
        fs.mkdirSync(FINAL_UPLOAD_DIR, { recursive: true });
        // Save JSON
        const jsonContent = req.file.buffer.toString("utf-8");
        fs.writeFileSync(outputPath, jsonContent);

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

        const trackId = sanitizedParams.id;
        const filePath = path.join(FINAL_UPLOAD_DIR, `${trackId}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send(res.__("file.errors.missing"));
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

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

        const track = await prisma.track.findUnique({ where: { id: parseInt(sanitizedParams.id) } });
        if (!track) {
            return response.status(404).send(response.__("track.errors.missing"));
        }
        // Without one, the track's own vehicle
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
router.post("/travel/file", isAuthenticated, upload.single("file"), async (req: Request, res: Response): Promise<any> => {
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

        const travelId = parseInt(sanitizedParams.id);
        const travel = await prisma.travel.findUnique({ where: { id: travelId } });
        if (!travel) {
            return res.status(404).send(res.__("track.errors.missing"));
        }
        if (travel.userId !== (req.user as User).id) {
            return res.status(403).send(res.__("auth.errors.unauthorized"));
        }

        const outputPath = path.join(TRAVEL_UPLOAD_DIR, `${travelId}.json`);

        fs.mkdirSync(TRAVEL_UPLOAD_DIR, { recursive: true });
        const jsonContent = req.file.buffer.toString("utf-8");
        fs.writeFileSync(outputPath, jsonContent);

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

        const travelId = sanitizedParams.id;
        const filePath = path.join(TRAVEL_UPLOAD_DIR, `${travelId}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send(res.__("file.errors.missing"));
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

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

        const travels = await prisma.travel.findMany({
            where: {
                trackId: parseInt(sanitizedParams.id),
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

      const trackId = parseInt(sanitizedParams.id);
      const vehicle = vehicleFilter(request.query);
      if (vehicle === null) {
        return response.status(422).send(response.__("track.errors.vehicle"));
      }

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
        const userId = (request.user as User).id;
        // Without one, the vehicle stays
        const vehicle = request.body.vehicle == null ? undefined : parseVehicle(request.body.vehicle);
        if (vehicle === null) {
            return response.status(422).send(response.__("track.errors.vehicle"));
        }

        // In one transaction, so no other user's travel can slip in between the check and the update
        const error = await prisma.$transaction(async (tx) => {
            const track = await tx.track.findUnique({ where: { id: parseInt(sanitizedParams.id) } });
            if (!track) return { status: 404, key: "track.errors.missing" };
            if (track.userId !== userId) return { status: 403, key: "track.errors.not-owner" };

            if (vehicle && vehicleClass(vehicle) !== vehicleClass(track.vehicle)) {
                const othersTravels = await tx.travel.count({ where: { trackId: track.id, userId: { not: userId } } });
                if (othersTravels > 0) return { status: 409, key: "track.errors.vehicle-class-locked" };
                // Only the owner's travels are left: they were made with the vehicle the track now says
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

        await prisma.track.delete({
            where: {
                id: parseInt(sanitizedParams.id),
                userId: (request.user as User).id
            }
        });
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

        const track = await prisma.track.findUnique({
            where: { id: parseInt(sanitizedParams.id) },
            include: {
                travels: { where: { vehicle } }
            }
        });

        if (!track) {
            return res.status(404).send(res.__("track.errors.missing"));
        }

        const userBestTravel = await prisma.travel.findFirst({
            where: { trackId: parseInt(sanitizedParams.id), userId: (req.user as User).id, vehicle },
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
            where: { trackId: parseInt(sanitizedParams.id), vehicle },
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
