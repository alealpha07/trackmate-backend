import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { prisma, UPLOAD_DIR } from "../utils";

const router = express.Router();
const POSTS_UPLOAD_DIR = path.join(UPLOAD_DIR, "posts");

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

router.get("/p/:id/image", async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(404).end();

        const filePath = path.join(POSTS_UPLOAD_DIR, `${id}-0.jpg`);
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
        const id = parseInt(req.params.id);
        const post = isNaN(id) ? null : await findSharedPost(id);
        if (!post) {
            return res.status(404).type("html").send(renderPage({
                title: "Post not found · TrackMate",
                body: `<div class="card empty"><h1>Post not found</h1><p>This post may have been deleted.</p></div>`,
            }));
        }

        const origin = publicOrigin(req);
        const pageUrl = `${origin}/p/${post.id}`;
        const imageUrl = post.imageCount > 0 ? `${origin}/p/${post.id}/image` : null;
        const title = escapeHtml(post.title);
        const description = escapeHtml(post.description);
        const username = escapeHtml(post.Track.user.username);
        const likes = post._count.likes;
        // Chrome/in-app browsers don't always hand verified links to the app, an intent: URL does
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
    <article class="card">
        <header><span class="avatar">${username.charAt(0).toUpperCase()}</span><span class="user">${username}</span></header>
        ${imageUrl ? `<img class="cover" src="${imageUrl}" alt="${title}">` : ""}
        <div class="content">
            <h1>${title}</h1>
            <p class="likes">${likes} ${likes === 1 ? "like" : "likes"}</p>
            ${description ? `<p class="description">${description}</p>` : ""}
            <a class="button" href="${appUrl}">Open in TrackMate</a>
            <p class="hint">Install the TrackMate app to ride this track and see the full post.</p>
        </div>
    </article>`,
        }));
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

const renderPage = ({ title, meta = "", body }: { title: string; meta?: string; body: string }) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>${meta}
    <style>
        :root { --primary: #6200ee; --bg: #f4f2f8; --card: #ffffff; --text: #1c1b1f; --muted: #6b6878; }
        @media (prefers-color-scheme: dark) {
            :root { --primary: #bb86fc; --bg: #121016; --card: #1e1b24; --text: #ece9f1; --muted: #a39fad; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: flex; justify-content: center; align-items: flex-start;
               padding: 32px 16px; background: var(--bg); color: var(--text);
               font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .card { width: 100%; max-width: 480px; background: var(--card); border-radius: 16px; overflow: hidden;
                box-shadow: 0 4px 24px rgba(0, 0, 0, .08); }
        header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; }
        .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: #fff;
                  display: grid; place-items: center; font-weight: 600; }
        .user { font-weight: 600; }
        .cover { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; }
        .content { padding: 16px; }
        h1 { font-size: 1.3rem; margin: 0 0 4px; }
        .likes { margin: 0 0 12px; color: var(--muted); font-size: .9rem; }
        .description { margin: 0 0 20px; line-height: 1.5; white-space: pre-line; }
        .button { display: block; text-align: center; padding: 14px; border-radius: 999px; background: var(--primary);
                  color: #fff; text-decoration: none; font-weight: 600; }
        .hint { margin: 12px 0 0; text-align: center; color: var(--muted); font-size: .85rem; }
        .empty { padding: 32px 24px; text-align: center; }
    </style>
</head>
<body>${body}
</body>
</html>`;

export default router;
