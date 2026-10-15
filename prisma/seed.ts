import { PrismaClient, Vehicle } from "@prisma/client";
import { dailyQuests } from "../src/quests";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const projectRoot = path.resolve(__dirname, "..");
const seedDir = path.join(projectRoot, "seed-data");
const uploadsDir = path.join(projectRoot, "uploads");

const PASSWORD = "trackmate";
const DAY_MS = 24 * 60 * 60 * 1000;

interface LatLng {
    lat: number;
    lng: number;
}

interface TrackPoint extends LatLng {
    timestamp: number;
    speed: number;
}

interface SeedPost {
    title: string;
    description: string;
    image: string;
}

interface SeedTrack {
    route: string;
    name: string;
    vehicle: Vehicle;
    kmh: number;
    // without a post the track stays private
    post?: SeedPost;
}

interface SeedUser {
    username: string;
    bio: string;
    image: string;
    tracks: SeedTrack[];
}

// routes planned on OpenStreetMap data by the backend's own planner
const USERS: SeedUser[] = [
    {
        username: "giulia",
        bio: "Economics student in Parma, always on my bike",
        image: "user1.jpg",
        tracks: [
            {
                route: "parma-economia-campus",
                name: "Economia → Campus",
                vehicle: Vehicle.BICYCLE,
                kmh: 17,
                post: {
                    title: "Morning ride to the Campus",
                    description: "From Economia in via Kennedy to the Campus. Cycle paths most of the way, 20 minutes and no traffic.",
                    image: "post-campus.jpg",
                },
            },
            {
                route: "parma-ducale-tardini",
                name: "Parco Ducale → Stadio Tardini",
                vehicle: Vehicle.BICYCLE,
                kmh: 15,
                post: {
                    title: "Matchday from the Parco Ducale",
                    description: "Across the river and through the centre to the Tardini. Leave early, the last bit gets busy before kick-off.",
                    image: "post-tardini.jpg",
                },
            },
            { route: "parma-garibaldi-cittadella", name: "Piazza Garibaldi → Cittadella", vehicle: Vehicle.FOOT, kmh: 5 },
        ],
    },
    {
        username: "marco",
        bio: "Walking and cycling around Milano",
        image: "user2.jpg",
        tracks: [
            {
                route: "milano-duomo-arco-pace",
                name: "Duomo → Arco della Pace",
                vehicle: Vehicle.FOOT,
                kmh: 4.8,
                post: {
                    title: "Duomo to Sempione on foot",
                    description: "Past the Castello and through Parco Sempione to the Arco della Pace. Perfect Sunday walk.",
                    image: "post-duomo.jpg",
                },
            },
            {
                route: "milano-politecnico-darsena",
                name: "Politecnico → Darsena",
                vehicle: Vehicle.BICYCLE,
                kmh: 16,
                post: {
                    title: "After class to the Navigli",
                    description: "From Piazza Leonardo da Vinci down to the Darsena for an aperitivo. Mind the tram tracks.",
                    image: "post-navigli.jpg",
                },
            },
            { route: "milano-centrale-duomo", name: "Centrale → Duomo", vehicle: Vehicle.BICYCLE, kmh: 14 },
        ],
    },
    {
        username: "lena",
        bio: "Berlin by bike, all year round",
        image: "user3.jpg",
        tracks: [
            {
                route: "berlin-brandenburger-tor-tempelhof",
                name: "Brandenburger Tor → Tempelhofer Feld",
                vehicle: Vehicle.BICYCLE,
                kmh: 19,
                post: {
                    title: "Tor to Tempelhof",
                    description: "From the Brandenburger Tor through Kreuzberg to the old airfield. Bike lanes almost all the way.",
                    image: "post-brandenburg.jpg",
                },
            },
            {
                route: "berlin-alexanderplatz-east-side-gallery",
                name: "Alexanderplatz → East Side Gallery",
                vehicle: Vehicle.FOOT,
                kmh: 5.2,
                post: {
                    title: "Alex to the East Side Gallery",
                    description: "Under the Fernsehturm and along the Spree to the longest stretch of the Wall still standing.",
                    image: "post-spree.jpg",
                },
            },
            { route: "berlin-siegessaeule-brandenburger-tor", name: "Siegessäule → Brandenburger Tor", vehicle: Vehicle.FOOT, kmh: 5 },
        ],
    },
];

// other users riding posted tracks, for the leaderboards
const RIDES: { username: string; route: string; kmh: number }[] = [
    { username: "giulia", route: "parma-economia-campus", kmh: 18.5 },
    { username: "marco", route: "parma-economia-campus", kmh: 19.5 },
    { username: "lena", route: "parma-ducale-tardini", kmh: 16 },
    { username: "giulia", route: "milano-politecnico-darsena", kmh: 15 },
    { username: "lena", route: "milano-duomo-arco-pace", kmh: 5.4 },
    { username: "giulia", route: "berlin-brandenburger-tor-tempelhof", kmh: 17 },
    { username: "marco", route: "berlin-alexanderplatz-east-side-gallery", kmh: 4.6 },
    { username: "lena", route: "berlin-brandenburger-tor-tempelhof", kmh: 20.5 },
];

const FRIENDS: { from: string; to: string; accepted: boolean }[] = [
    { from: "giulia", to: "marco", accepted: true },
    { from: "marco", to: "lena", accepted: true },
    { from: "lena", to: "giulia", accepted: false },
];

const LIKES: { username: string; post: string }[] = [
    { username: "marco", post: "parma-economia-campus" },
    { username: "lena", post: "parma-economia-campus" },
    { username: "lena", post: "parma-ducale-tardini" },
    { username: "giulia", post: "milano-politecnico-darsena" },
    { username: "lena", post: "milano-duomo-arco-pace" },
    { username: "giulia", post: "berlin-brandenburger-tor-tempelhof" },
    { username: "marco", post: "berlin-brandenburger-tor-tempelhof" },
];

const SAVES: { username: string; post: string }[] = [
    { username: "giulia", post: "berlin-brandenburger-tor-tempelhof" },
    { username: "lena", post: "milano-duomo-arco-pace" },
    { username: "marco", post: "parma-ducale-tardini" },
];

function haversineMeters(a: LatLng, b: LatLng) {
    const R = 6371e3;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// fixed seed, so every run gives the same rides
function random(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// speed wanders around the average, slower at the start and the end
function ride(route: LatLng[], kmh: number, start: number, seed: number): TrackPoint[] {
    const next = random(seed);
    let factor = 1;
    let time = start;
    return route.map((point, i) => {
        if (i > 0) {
            factor = Math.min(1.25, Math.max(0.75, factor + (1 - factor) * 0.2 + (next() - 0.5) * 0.12));
            const edge = Math.min(i, route.length - 1 - i);
            const speed = kmh * factor * (edge < 3 ? 0.6 : 1);
            time += haversineMeters(route[i - 1], point) / (speed / 3.6) * 1000;
            return { ...point, timestamp: Math.round(time), speed: +speed.toFixed(1) };
        }
        return { ...point, timestamp: start, speed: 0 };
    });
}

function stats(points: TrackPoint[]) {
    let meters = 0;
    for (let i = 1; i < points.length; i++) meters += haversineMeters(points[i - 1], points[i]);
    const seconds = (points[points.length - 1].timestamp - points[0].timestamp) / 1000;
    return {
        distance: +(meters / 1000).toFixed(2),
        time: +seconds.toFixed(2),
        averageSpeed: +(meters / seconds * 3.6).toFixed(2),
        maxSpeed: Math.max(...points.map((p) => p.speed)),
    };
}

function readRoute(name: string): LatLng[] {
    return JSON.parse(fs.readFileSync(path.join(seedDir, "routes", `${name}.json`), "utf-8")).track;
}

function writeUpload(dir: string, name: string, content: string | Buffer) {
    fs.mkdirSync(path.join(uploadsDir, dir), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, dir, name), content);
}

async function addTravel(userId: number, trackId: number, vehicle: Vehicle, route: LatLng[], kmh: number, daysAgo: number) {
    const start = Date.now() - daysAgo * DAY_MS;
    const points = ride(route, kmh, start, trackId * 100 + userId * 7 + daysAgo);
    const travel = await prisma.travel.create({
        data: { userId, trackId, vehicle, dateTime: new Date(start), ...stats(points) },
    });
    writeUpload("travel", `${travel.id}.json`, JSON.stringify({ track: points }));
    return points;
}

async function main() {
    const existingData = await prisma.user.findFirst();
    if (existingData) {
        console.log("Seed skipped: database already has data.");
        return;
    }

    const password = await bcrypt.hash(PASSWORD, 12);
    const userIds = new Map<string, number>();
    const tracks = new Map<string, { id: number; vehicle: Vehicle }>();
    const posts = new Map<string, number>();

    for (const [u, seed] of USERS.entries()) {
        const user = await prisma.user.create({
            data: {
                username: seed.username,
                password,
                bio: seed.bio,
                vehicles: { create: Object.values(Vehicle).map((vehicle) => ({ vehicle })) },
                quests: { create: dailyQuests(Object.values(Vehicle)) },
            },
        });
        userIds.set(seed.username, user.id);
        fs.mkdirSync(path.join(uploadsDir, "profile"), { recursive: true });
        fs.copyFileSync(path.join(seedDir, seed.image), path.join(uploadsDir, "profile", `${user.id}.jpg`));

        for (const [t, seedTrack] of seed.tracks.entries()) {
            const track = await prisma.track.create({
                data: { userId: user.id, name: seedTrack.name, vehicle: seedTrack.vehicle },
            });
            tracks.set(seedTrack.route, { id: track.id, vehicle: seedTrack.vehicle });
            // the recording that created the track is also its first travel
            const route = readRoute(seedTrack.route);
            const points = await addTravel(user.id, track.id, seedTrack.vehicle, route, seedTrack.kmh, 20 - u * 3 - t);
            writeUpload("track", `${track.id}.json`, JSON.stringify({ track: points }));

            if (seedTrack.post) {
                const post = await prisma.post.create({
                    data: {
                        trackId: track.id,
                        title: seedTrack.post.title,
                        description: seedTrack.post.description,
                        imageCount: 1,
                        createdAt: new Date(Date.now() - (10 - u * 3 - t) * DAY_MS),
                    },
                });
                posts.set(seedTrack.route, post.id);
                fs.mkdirSync(path.join(uploadsDir, "posts"), { recursive: true });
                fs.copyFileSync(path.join(seedDir, seedTrack.post.image), path.join(uploadsDir, "posts", `${post.id}-0.jpg`));
            }
        }
    }

    for (const [i, r] of RIDES.entries()) {
        const track = tracks.get(r.route)!;
        await addTravel(userIds.get(r.username)!, track.id, track.vehicle, readRoute(r.route), r.kmh, 8 - i % 8);
    }

    for (const f of FRIENDS) {
        await prisma.friendRequest.create({
            data: { senderId: userIds.get(f.from)!, receiverId: userIds.get(f.to)!, status: f.accepted },
        });
    }
    for (const l of LIKES) {
        await prisma.like.create({ data: { userId: userIds.get(l.username)!, postId: posts.get(l.post)! } });
    }
    for (const s of SAVES) {
        await prisma.save.create({ data: { userId: userIds.get(s.username)!, postId: posts.get(s.post)! } });
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
