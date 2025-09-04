import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated, UPLOAD_DIR } from "../utils";
import multer from "multer"
import path from "path"
import fs from "fs";

const router = express.Router();
const FINAL_UPLOAD_DIR = path.join(UPLOAD_DIR, "track");

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Upload track JSON
router.post("/file", upload.single("file"), isAuthenticated, async (req: Request, res: Response): Promise<any> => {
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

        const trackId = sanitizedParams.id
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
        const requiredParams = ["name"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const track = await prisma.track.create({
            data: {
                userId: (request.user as User).id,
                name: sanitizedParams.name
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

        await prisma.travel.create({
            data: {
                userId: (request.user as User).id,
                trackId: sanitizedParams.id,
                time: sanitizedParams.time,
                averageSpeed: sanitizedParams.averageSpeed,
                maxSpeed: sanitizedParams.maxSpeed,
                distance: sanitizedParams.distance,
                dateTime: new Date()
            }
        });
        response.send(response.__("track.success.travel"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get travels
router.get("/travel", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        let travels = await prisma.travel.findMany({
            where: {
                userId: (request.user as User).id
            },
            include: {
                Track: {
                    select: {
                        name: true
                    }
                }
            }
        });
        travels = travels.map((t) => {
            return {
                ...t,
                dateTimeString: t.dateTime.toLocaleDateString('it-IT'),
                name: t.Track?.name || "unknown"
            }
        })
        response.send(travels);
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

        let travels = await prisma.travel.findMany({
            where: {
                trackId: parseInt(sanitizedParams.id)
            },
            include: {
                Track: {
                    select: {
                        name: true
                    }
                }
            }
        });
        travels = travels.map((t) => {
            return {
                ...t,
                dateTimeString: t.dateTime.toLocaleDateString('it-IT'),
                name: t.Track?.name || "unknown"
            }
        })
        response.send(travels);
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

      const leaderboard = await prisma.travel.groupBy({
        by: ["userId"],
        where: {
          trackId: trackId,
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

        await prisma.track.update({
            where: {
                id: parseInt(sanitizedParams.id)
            },
            data: {
                name: sanitizedParams.name
            }
        });
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
router.get("/", isAuthenticated, async (req: Request, res: Response) => {
    try {
        const userId = (req.user as User).id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                tracks: {
                    include: {
                        travels: {
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
router.get("/details", isAuthenticated, async (req: Request, res: Response) => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);

        if (missingParams.length > 0) {
            return res
                .status(422)
                .send(res.__("server.missing-params") + missingParams.map((p) => res.__(p)).join(", "));
        }

        const track = await prisma.track.findUnique({
            where: { id: parseInt(sanitizedParams.id) },
            include: {
                travels: true
            }
        });

        if (!track) {
            return res.status(404).send(res.__("track.errors.missing"));
        }

        const userBestTravel = await prisma.travel.findFirst({
            where: { trackId: parseInt(sanitizedParams.id), userId: (req.user as User).id },
            orderBy: { time: "asc" },
            select: {
                id: true,
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
            where: { trackId: parseInt(sanitizedParams.id) },
            orderBy: { time: "asc" },
            select: {
                id: true,
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
                distance: travel.distance
            };
        };

        res.json({
            id: track.id,
            name: track.name,
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
