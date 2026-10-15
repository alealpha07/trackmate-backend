import express, { Request, Response } from "express";
import fs from "fs";
import { parseId, prisma } from "../utils";
import { postImageFile } from "../files";

const router = express.Router();

const ANDROID_PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME || "com.example.trackmate";
const ANDROID_CERT_SHA256 = (process.env.ANDROID_CERT_SHA256 || "")
    .split(",")
    .map((fingerprint) => fingerprint.trim())
    .filter(Boolean);

router.get("/.well-known/assetlinks.json", (req: Request, res: Response) => {
    res.json([
        {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
                namespace: "android_app",
                package_name: ANDROID_PACKAGE_NAME,
                sha256_cert_fingerprints: ANDROID_CERT_SHA256,
            },
        },
    ]);
});

const escapeHtml = (text: string) =>
    text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const publicOrigin = (req: Request) => process.env.PUBLIC_URL || `https://${req.get("host")}`;

const findSharedPost = (id: number) =>
    prisma.post.findUnique({
        where: { id },
        include: {
            Track: { include: { user: { select: { username: true } } } },
            _count: { select: { likes: true } },
        },
    });

// posting is the choice to go public, but search engines stay out
router.use("/p", (req: Request, res: Response, next) => {
    res.set("X-Robots-Tag", "noindex");
    next();
});

router.get("/p/:id/image", async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(404).end();

        const filePath = postImageFile(id, 0);
        if (!fs.existsSync(filePath)) return res.status(404).end();

        res.set("Cache-Control", "public, max-age=3600");
        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).end();
    }
});

// Landing page for shared links opened without the app
router.get("/p/:id", async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseId(req.params.id);
        const post = id ? await findSharedPost(id) : null;
        if (!post) {
            return res.status(404).type("html").send(renderPage({
                title: "Post not found · TrackMate",
                body: `<div class="card empty"><h2>Post not found</h2><p>This post may have been deleted.</p></div>`,
            }));
        }

        const origin = publicOrigin(req);
        const pageUrl = `${origin}/p/${post.id}`;
        const imageUrl = post.imageCount > 0 ? `${origin}/p/${post.id}/image` : null;
        const title = escapeHtml(post.title);
        const description = escapeHtml(post.description);
        const username = escapeHtml(post.Track.user.username);
        const likes = post._count.likes;
        // in-app browsers don't always hand app links to the app
        const appUrl = `intent://${req.get("host")}/p/${post.id}#Intent;scheme=https;package=${ANDROID_PACKAGE_NAME};end`;

        res.type("html").send(renderPage({
            title: `${title} · TrackMate`,
            meta: `
    <meta name="description" content="${description}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="TrackMate">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description || `A track shared by ${username}`}">
    <meta property="og:url" content="${pageUrl}">
    ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""}
    <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">`,
            body: `
    <article class="card post">
        <header class="author">${PERSON_AVATAR}<span class="user">${username}</span></header>
        <h2>${title}</h2>
        ${imageUrl ? `<img class="cover" src="${imageUrl}" alt="${title}">` : ""}
        <div class="content">
            <p class="likes">${likes} ${likes === 1 ? "like" : "likes"}</p>
            ${description ? `<p class="description">${description}</p>` : ""}
            <a class="button open" href="${appUrl}">${NAVIGATION_ICON}<span>Open in TrackMate</span></a>
            <p class="hint">Install the TrackMate app to ride this track and see the full post.</p>
        </div>
    </article>`,
        }));
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

// same icons as the app
const PERSON_AVATAR = `<span class="avatar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></span>`;
const NAVIGATION_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;

const renderPage = ({ title, meta = "", body }: { title: string; meta?: string; body: string }) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>${title}</title>${meta}
    <link rel="icon" href="/img/icon.webp">
    <link rel="stylesheet" href="/vendor/roboto/400.css">
    <link rel="stylesheet" href="/vendor/roboto/500.css">
    <link rel="stylesheet" href="/vendor/roboto/700.css">
    <link rel="stylesheet" href="/theme.css">
    <style>
        main { display: flex; justify-content: center; padding: 24px 16px; }
        .card { width: 100%; max-width: 480px; }
        .author { display: flex; align-items: center; gap: 8px; padding: 16px 16px 0; }
        .avatar { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--divider); }
        .avatar svg { width: 26px; height: 26px; fill: var(--muted); }
        .user { font-size: 1rem; }
        .post h2 { margin: 8px 16px 12px; font-size: 1.1rem; font-weight: 500; }
        .cover { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: var(--divider); }
        .content { padding: 12px 16px 16px; }
        .likes { margin: 0 0 4px; font-size: .9rem; font-weight: 500; }
        .description { margin: 0; line-height: 1.5; white-space: pre-line; }
        .open { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; }
        .open svg { width: 20px; height: 20px; fill: currentColor; }
        .hint { margin: 12px 0 0; text-align: center; color: var(--muted); font-size: .85rem; }
        .empty { padding: 32px 24px; text-align: center; }
        .empty h2 { margin: 0 0 8px; color: var(--heading); font-weight: 500; }
    </style>
</head>
<body>
    <header class="app-bar"><img class="app-icon" src="/img/icon.webp" alt=""><h1>TrackMate</h1></header>
    <main>${body}
    </main>
</body>
</html>`;

export default router;
