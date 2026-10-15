import express, { Request, Response } from "express";
import { User } from "../generated/prisma/client.js";
import { sanitizeParams, prisma, isAuthenticated, parseId, sendInvalidId, PUBLIC_USER } from "../utils.js";
import { postImageFile, postImageFiles, removeFiles } from "../files.js";
import { fileLimit } from "../limits.js";
import multer from "multer"
import path from "path"
import fs from "fs";
import sharp from "sharp";

const router = express.Router();
const POST_WITH_AUTHOR = { Track: { include: { user: { select: PUBLIC_USER } } } } as const;

const hasTexts = (params: any) => typeof params.title === "string" && typeof params.description === "string";

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

// sends the error itself when the post is missing or someone else's
async function findOwnPost(response: Response, rawId: unknown, userId: number) {
    const id = parseId(rawId);
    if (!id) {
        sendInvalidId(response);
        return null;
    }
    const post = await prisma.post.findUnique({ where: { id }, include: { Track: { select: { userId: true } } } });
    if (!post) {
        response.status(404).send(response.__("post.errors.missing"));
        return null;
    }
    if (post.Track.userId !== userId) {
        response.status(403).send(response.__("post.errors.not-owner"));
        return null;
    }
    return post;
}

async function findPostId(response: Response, rawId: unknown): Promise<number | null> {
    const id = parseId(rawId);
    if (!id) {
        sendInvalidId(response);
        return null;
    }
    if (!(await prisma.post.findUnique({ where: { id }, select: { id: true } }))) {
        response.status(404).send(response.__("post.errors.missing"));
        return null;
    }
    return id;
}

//#region Image

// Upload Image
router.post("/image", isAuthenticated, fileLimit, upload.single("file"), async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.file) {
            return res.status(422).json(res.__("file.errors.missing"));
        }

        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);
        if (missingParams.length > 0) {
            return res.status(422).send(
                res.__("server.missing-params") +
                missingParams.map((p) => res.__(p)).join(", ")
            );
        }

        const post = await findOwnPost(res, sanitizedParams.id, (req.user as User).id);
        if (!post) return;
        const outputPath = postImageFile(post.id, post.imageCount);

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        await sharp(req.file.buffer)
            .resize(1024, 1024, { fit: "cover" })
            .jpeg({ quality: 90 })
            .toFile(outputPath);

        // Increase image count in db
        await prisma.post.update({
            where: { id: post.id },
            data: { imageCount: post.imageCount + 1 }
        })

        res.json(res.__("file.success.upload"));
    } catch (error: any) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

// Get User Image
router.get("/image", isAuthenticated, async (req: Request, res: Response): Promise<any> => {
    try {
        const requiredParams = ["id", "index"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, req.query);
        if (missingParams.length > 0) {
            return res.status(422).send(
                res.__("server.missing-params") +
                missingParams.map((p) => res.__(p)).join(", ")
            );
        }

        const id = parseId(sanitizedParams.id);
        const index = /^\d{1,3}$/.test(String(sanitizedParams.index)) ? Number(sanitizedParams.index) : null;
        if (!id || index === null) {
            return sendInvalidId(res);
        }
        const filePath = postImageFile(id, index);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json(res.__("file.errors.missing"));
        }

        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).send(res.__("server.error"));
    }
});

//#endregion

//#region CRUD

// Create Post
router.post("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id", "title", "description"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const userId = (request.user as User).id;
        const trackId = parseId(sanitizedParams.id);
        if (!trackId) {
            return sendInvalidId(response);
        }
        if (!hasTexts(sanitizedParams)) {
            return response.status(422).send(response.__("server.bad-request"));
        }
        const track = await prisma.track.findUnique({ where: { id: trackId }, select: { userId: true } });
        if (!track) {
            return response.status(404).send(response.__("track.errors.missing"));
        }
        if (track.userId !== userId) {
            return response.status(403).send(response.__("track.errors.not-owner"));
        }

        // Clear this user's previous partial posts
        await prisma.post.deleteMany({
            where: {
                imageCount: 0,
                Track: { userId }
            }
        });

        // Create partial post
        const post = await prisma.post.create({
            data: {
                trackId,
                title: sanitizedParams.title,
                description: sanitizedParams.description
            }
        });
        response.send({ id: post.id });
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Update Post
router.put("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id", "title", "description"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        if (!hasTexts(sanitizedParams)) {
            return response.status(422).send(response.__("server.bad-request"));
        }
        const post = await findOwnPost(response, sanitizedParams.id, (request.user as User).id);
        if (!post) return;

        await prisma.post.update({
            where: { id: post.id },
            data: {
                title: sanitizedParams.title,
                description: sanitizedParams.description
            }
        });
        response.send(response.__("post.success.update"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Delete Post
router.delete("/", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const post = await findOwnPost(response, sanitizedParams.id, (request.user as User).id);
        if (!post) return;

        await prisma.post.delete({ where: { id: post.id } });
        removeFiles(postImageFiles(post.id));
        response.send(response.__("post.success.delete"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get Post
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

        const post = await prisma.post.findUnique({
            where: { id },
            include: {
                ...POST_WITH_AUTHOR,
                saves: true,
                likes: true
            }
        });

        if (!post) {
            return response.status(404).send(response.__("post.errors.missing"));
        }

        const liked = post.likes.some(like => like.userId === (request.user as User).id);
        const saved = post.saves.some(save => save.userId === (request.user as User).id);
        const likeCount = post.likes.length;

        const responseData = {
            ...post,
            username: post.Track.user.username,
            userId: post.Track.userId,
            liked,
            saved,
            likeCount,
        };

        response.send(responseData);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

//#endregion

//#region Likes and Saves

// Add Like to Post
router.post("/like", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const postId = await findPostId(response, sanitizedParams.id);
        if (!postId) return;

        const userId = (request.user as User).id;
        await prisma.like.upsert({
            where: { userId_postId: { userId, postId } },
            create: { userId, postId },
            update: {}
        });
        response.send(response.__("post.success.like"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Remove Like to Post
router.delete("/like", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const postId = parseId(sanitizedParams.id);
        if (!postId) {
            return sendInvalidId(response);
        }

        await prisma.like.deleteMany({ where: { userId: (request.user as User).id, postId } });
        response.send(response.__("post.success.unlike"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Save Post
router.post("/save", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const postId = await findPostId(response, sanitizedParams.id);
        if (!postId) return;

        const userId = (request.user as User).id;
        await prisma.save.upsert({
            where: { userId_postId: { userId, postId } },
            create: { userId, postId },
            update: {}
        });
        response.send(response.__("post.success.save"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Un Save Post
router.delete("/save", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const postId = parseId(sanitizedParams.id);
        if (!postId) {
            return sendInvalidId(response);
        }

        await prisma.save.deleteMany({ where: { userId: (request.user as User).id, postId } });
        response.send(response.__("post.success.unsave"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

//#endregion

//#region list posts

// Get Post List by user
router.get("/user", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["id"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const userId = parseId(sanitizedParams.id);
        if (!userId) {
            return sendInvalidId(response);
        }

        const posts = await prisma.post.findMany({
            where: {
                Track: {
                    userId
                }
            },
            include: {
                ...POST_WITH_AUTHOR,
                saves: true,
                likes: true
            }
        });
        const postsList = posts.map((post) => {
            if (!post) {
                return
            }

            const liked = post.likes.some(like => like.userId === (request.user as User).id);
            const saved = post.saves.some(save => save.userId === (request.user as User).id);
            const likeCount = post.likes.length;

            return {
                ...post,
                username: post.Track.user.username,
                userId: post.Track.userId,
                liked,
                saved,
                likeCount,
            };
        })
        response.send(postsList);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get Post List by friends
router.get("/friends", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["offset"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        const limit = 10;
        const offset = parseInt(sanitizedParams.offset);


        const friendRequests = await prisma.friendRequest.findMany({
            where: {
                status: true,
                OR: [
                    { senderId: (request.user as User).id },
                    { receiverId: (request.user as User).id },
                ],
            },
            select: {
                senderId: true,
                receiverId: true,
            },
        });

        const friendIds = friendRequests.map(fr =>
            fr.senderId === (request.user as User).id ? fr.receiverId : fr.senderId
        );

        const friendPosts = await prisma.post.findMany({
            where: {
                Track: {
                    userId: {
                        in: friendIds,
                    },
                },
            },
            orderBy: {
                createdAt: "desc"
            },
            include: {
                ...POST_WITH_AUTHOR,
                saves: true,
                likes: true,
            },
        });
        const postsList = friendPosts.map((post) => {
            if (!post) {
                return
            }

            const liked = post.likes.some(like => like.userId === (request.user as User).id);
            const saved = post.saves.some(save => save.userId === (request.user as User).id);
            const likeCount = post.likes.length;

            return {
                ...post,
                username: post.Track.user.username,
                userId: post.Track.userId,
                liked,
                saved,
                likeCount,
            };
        }).slice(offset, offset + limit)
        response.send(postsList);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get saved posts
router.get("/saved", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const posts = await prisma.save.findMany({
            where: {
                userId: (request.user as User).id,
            },
            include: {
                post: {
                    include: {
                        ...POST_WITH_AUTHOR,
                        likes: true,
                        saves: true,
                    },
                },
            },
        });
        const postsList = posts.map((save) => {
            if (!save) {
                return
            }

            const liked = save.post.likes.some(like => like.userId === (request.user as User).id);
            const saved = save.post.saves.some(save => save.userId === (request.user as User).id);
            const likeCount = save.post.likes.length;

            return {
                ...save.post,
                username: save.post.Track.user.username,
                userId: save.post.Track.userId,
                liked,
                saved,
                likeCount,
            };
        })
        response.send(postsList);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

// Get trending posts
router.get(
    "/trending",
    isAuthenticated,
    async (request: Request, response: Response): Promise<any> => {
        try {
            const requiredParams = ["offset"];
            const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
            if (missingParams.length > 0) {
                return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
            }
            const limit = 10;
            const offset = parseInt(sanitizedParams.offset);

            const posts = await prisma.post.findMany({
                where: {
                    NOT: {
                        Track: { userId: (request.user as User).id }
                    }
                },
                include: {
                    ...POST_WITH_AUTHOR,
                    likes: true,
                    saves: true,
                    _count: { select: { likes: true, saves: true } },
                },
            });

            const trending = posts
                .map((p) => ({
                    ...p,
                    popularity: p._count.likes + p._count.saves,
                }))
                .sort((a, b) => b.popularity - a.popularity || b.createdAt.getTime() - a.createdAt.getTime())
                .slice(offset, offset + limit)
                .map((post) => {
                    if (!post) return;

                    const liked = post.likes.some(
                        (like) => like.userId === (request.user as User).id
                    );
                    const saved = post.saves.some(
                        (save) => save.userId === (request.user as User).id
                    );
                    const likeCount = post.likes.length;

                    return {
                        ...post,
                        username: post.Track.user.username,
                        userId: post.Track.userId,
                        liked,
                        saved,
                        likeCount,
                    };
                });

            response.send(trending);
        } catch (error) {
            response.status(500).send(response.__("server.error"));
            console.error(error);
        }
    }
);

//#endregion

export default router;

