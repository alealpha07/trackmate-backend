import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated } from "../utils";

const router = express.Router();

router.get("/", isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        const requiredParams = ["text"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);
        if (missingParams.length > 0) {
            return res.status(422).send(
                res.__("server.missing-params") +
                missingParams.map((p) => res.__(p)).join(", ")
            );
        }

        const searchText = (sanitizedParams.text as string).toLowerCase();
        const sortBy = (req.query.sortBy as string) || "score"; 

        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { username: { contains: searchText } },
                    { bio: { contains: searchText } }
                ]
            },
            include: {
                travels: { select: { distance: true } },
                sentFriendRequests: { where: { status: true }, select: { receiverId: true } },
                receivedFriendRequests: { where: { status: true }, select: { senderId: true } },
                tracks: {
                    select: {
                        posts: { select: { id: true } }
                    }
                }
            }
        });

        const enrichedUsers = users.map(u => {
            const totalTravelled = u.travels.reduce((sum, t) => sum + t.distance, 0);
            const friendsCount = u.sentFriendRequests.length + u.receivedFriendRequests.length;
            const postsCount = u.tracks.reduce((sum, track) => sum + track.posts.length, 0);

            return {
                type: "user",
                id: u.id,
                username: u.username,
                bio: u.bio,
                level: u.level,
                experience: u.experience,
                friendsCount,
                postsCount,
                totalTravelled,
                score: sortBy === "distance"
                    ? totalTravelled
                    : sortBy === "posts"
                        ? postsCount
                        : friendsCount
            };
        }).filter(u => u.id != (req.user as User).id);

        const posts = await prisma.post.findMany({
            where: {
                OR: [
                    { title: { contains: searchText } },
                    { description: { contains: searchText } }
                ],
                NOT: {
                    Track: {
                        userId: (req.user as User).id
                    }
                }
            },
            include: {
                Track: {
                    include: {
                        user: true,
                    },
                },
                likes: { select: { id: true } },
                saves: { select: { id: true } }
            }
        });

        const enrichedPosts = posts.map(p => {
            const likesCount = p.likes.length;
            const savesCount = p.saves.length;
            const score = likesCount + savesCount;

            return {
                type: "post",
                userId: p.Track.userId,
                id: p.id,
                title: p.title,
                description: p.description,
                createdAt: p.createdAt,
                trackId: p.trackId,
                username: p.Track.user.username,
                likesCount,
                savesCount,
                score
            };
        });

        const mixedResults = [...enrichedUsers, ...enrichedPosts];

        mixedResults.sort((a, b) => b.score - a.score);

        res.json(mixedResults);

    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

export default router