import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated, UPLOAD_DIR } from "../utils";
import multer from "multer"
import path from "path"
import fs from "fs";
import sharp from "sharp";

const router = express.Router();
const FINAL_UPLOAD_DIR = path.join(UPLOAD_DIR, "posts");

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

//#region Image

// Upload Image
router.post("/image", upload.single("file"), isAuthenticated, async (req: Request, res: Response): Promise<any> => {
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

        const post = await prisma.post.findUnique({ where: { id: parseInt(sanitizedParams.id) } });
        if (!post) {
            return res.json(res.__("post.errors.missing"));
        }
        const outputPath = path.join(FINAL_UPLOAD_DIR, `${post.id}-${post.imageCount}.jpg`);

        // Increase image count in db
        await prisma.post.update({
            where: { id: post.id },
            data: { imageCount: post.imageCount + 1 }
        })

        // Ensure the directory exists
        fs.mkdirSync(FINAL_UPLOAD_DIR, { recursive: true });

        // Convert and save image as JPG using sharp
        await sharp(req.file.buffer)
            .resize(1024, 1024, { fit: "cover" })
            .jpeg({ quality: 90 })
            .toFile(outputPath);

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

        const { id, index } = sanitizedParams;
        const filePath = path.join(FINAL_UPLOAD_DIR, `${id}-${index}.jpg`);
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

        // Clear previous partial posts
        await prisma.post.deleteMany({
            where: {
                imageCount: 0
            }
        });

        // Create partial post
        const post = await prisma.post.create({
            data: {
                trackId: sanitizedParams.id,
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

        await prisma.post.update({
            where: { id: sanitizedParams.id },
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

        const regex = new RegExp(`^${sanitizedParams.id}-\\d+\\.jpg$`);

        fs.readdirSync(FINAL_UPLOAD_DIR).forEach(file => {
            if (regex.test(file)) {
                const filePath = path.join(FINAL_UPLOAD_DIR, file);
                fs.unlinkSync(filePath);
            }
        });

        await prisma.post.delete({ where: { id: parseInt(sanitizedParams.id), Track: { userId: (request.user as User).id } } });
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

        const post = await prisma.post.findUnique({
            where: { id: parseInt(sanitizedParams.id) },
            include: {
                Track: {
                    include: {
                        user: true,
                    },
                },
                saves: true,
                likes: true
            }
        });

        if (!post) {
            return response.status(404).send(response.__("post.missing"));
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

        await prisma.like.create({
            data: {
                userId: (request.user as User).id,
                postId: sanitizedParams.id
            }
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

        await prisma.like.deleteMany({ where: { userId: (request.user as User).id, postId: parseInt(sanitizedParams.id) } });
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

        await prisma.save.create({
            data: {
                userId: (request.user as User).id,
                postId: sanitizedParams.id
            }
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

        await prisma.save.deleteMany({ where: { userId: (request.user as User).id, postId: parseInt(sanitizedParams.id) } });
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

        const posts = await prisma.post.findMany({
            where: {
                Track: {
                    userId: parseInt(sanitizedParams.id)
                }
            },
            include: {
                Track: {
                    include: {
                        user: true,
                    },
                },
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
            include: {
                Track: {
                    include: {
                        user: true,
                    },
                },
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
                        Track: {
                            include: {
                                user: true,
                            },
                        },
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

            const days = 7;
            const fromDate = new Date();
            fromDate.setDate(fromDate.getDate() - days);

            let posts = await prisma.post.findMany({
                where: {
                    createdAt: { gte: fromDate }, NOT: {
                        Track: { userId: (request.user as User).id }
                    }
                },
                include: {
                    Track: {
                        include: { user: true },
                    },
                    likes: true,
                    saves: true,
                    _count: { select: { likes: true, saves: true } },
                },
            });

            if (posts.length === 0) {
                posts = await prisma.post.findMany({
                    where: {
                        NOT: {
                            Track: { userId: (request.user as User).id }
                        }
                    },
                    include: {
                        Track: {
                            include: { user: true },
                        },
                        likes: true,
                        saves: true,
                        _count: { select: { likes: true, saves: true } },
                    },
                });
            }

            const trending = posts
                .map((p) => ({
                    ...p,
                    popularity: p._count.likes + p._count.saves,
                }))
                .sort((a, b) => b.popularity - a.popularity)
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

