import { PrismaClient, QuestType, User, Track } from "@prisma/client";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const projectRoot = path.resolve(__dirname, "..");
const uploadsDir = path.join(projectRoot, "uploads");

interface TrackPoint {
    lat: number;
    lng: number;
    timestamp: number;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371e3; // meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // meters
}

function calculateTravelData(trackPoints: TrackPoint[]) {
    let totalDistance = 0; // meters
    let maxSpeed = 0; // m/s
    let totalTime = 0; // seconds

    for (let i = 1; i < trackPoints.length; i++) {
        const p1 = trackPoints[i - 1];
        const p2 = trackPoints[i];

        const dist = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
        const time = (p2.timestamp - p1.timestamp) / 1000; // ms to s

        const speed = time > 0 ? dist / time : 0;

        totalDistance += dist;
        totalTime += time;
        if (speed > maxSpeed) maxSpeed = speed;
    }

    const avgSpeed = totalTime > 0 ? totalDistance / totalTime : 0;

    return { distance: totalDistance, time: totalTime, averageSpeed: avgSpeed, maxSpeed };
}

function ensureDirs() {
    ["profile", "posts", "track"].forEach((dir) => {
        const fullPath = path.join(uploadsDir, dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    });
}

function copyFile(src: string, dest: string) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${dest}`);
}

async function main() {
    const existingData = await prisma.user.findFirst();
    if (existingData) {
        console.log("Seed skipped: database already has data.");
        return;
    }

    ensureDirs();

    const userSeeds = [
        { username: "admin", password: "admin", bio: "I am the admin", img: "user1.jpg" },
        { username: "user", password: "user", bio: "Regular user", img: "user2.jpg" },
        { username: "guest", password: "guest", bio: "Just visiting", img: "user3.jpg" },
    ];

    const users: User[] = [];
    for (const u of userSeeds) {
        const hashedPassword = await bcrypt.hash(u.password, 10);
        const user = await prisma.user.create({ data: { username: u.username, password: hashedPassword, bio: u.bio } });
        users.push(user);
        copyFile(
            path.join(projectRoot, "seed-data", u.img),
            path.join(uploadsDir, "profile", `${user.id}.jpg`)
        );
    }

    let postImageIndex = 1;
    for (const user of users) {
        const tracks: Track[] = [];
        for (let i = 1; i <= 2; i++) {
            const track = await prisma.track.create({
                data: {
                    name: `${user.username}-track-${i}`,
                    userId: user.id,
                },
            });
            tracks.push(track);

            const trackSrc = path.join(projectRoot, "seed-data", `track${i}.json`);
            copyFile(trackSrc, path.join(uploadsDir, "track", `${track.id}.json`));

            const raw = fs.readFileSync(trackSrc, "utf-8");
            const trackJson = JSON.parse(raw);
            const trackPoints: TrackPoint[] = trackJson.track;

            const { distance, time, averageSpeed, maxSpeed } = calculateTravelData(trackPoints);

            await prisma.travel.create({
                data: {
                    trackId: track.id,
                    userId: user.id,
                    dateTime: new Date(trackPoints[0].timestamp),
                    distance,
                    time,
                    averageSpeed,
                    maxSpeed,
                },
            });
        }

        for (let i = 1; i <= 2; i++) {
            const post = await prisma.post.create({
                data: {
                    title: `${user.username}-post-${i}`,
                    description: `Post ${i} by ${user.username}`,
                    trackId: tracks[0].id,
                    imageCount: 1
                },
            });

            const postImg1 = path.join(projectRoot, "seed-data", `post${postImageIndex}.jpg`);
            copyFile(postImg1, path.join(uploadsDir, "posts", `${post.id}-0.jpg`));
            postImageIndex++;
        }

        const quests = [
            {
                description: "Travel 10 km",
                experience: 100,
                maxProgress: 10,
                type: QuestType.TRAVEL_DISTANCE,
            },
            {
                description: "Record a track",
                experience: 50,
                maxProgress: 1,
                type: QuestType.RECORD_TRACK,
            },
            {
                description: "Navigate a track",
                experience: 75,
                maxProgress: 1,
                type: QuestType.NAVIGATE_TRACK,
            },
        ];

        for (const q of quests) {
            await prisma.quest.create({ data: { ...q, userId: user.id } });
        }
    }
}

main()
    .then(async () => {
        console.log("Seeding finished.");
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });