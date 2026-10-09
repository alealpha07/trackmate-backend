-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Track" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    CONSTRAINT "Track_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Existing tracks and travels were mostly by car
INSERT INTO "new_Track" ("id", "name", "userId", "vehicle") SELECT "id", "name", "userId", 'CAR' FROM "Track";
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";
CREATE TABLE "new_Travel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trackId" INTEGER,
    "userId" INTEGER NOT NULL,
    "time" REAL NOT NULL,
    "dateTime" DATETIME NOT NULL,
    "maxSpeed" REAL NOT NULL,
    "averageSpeed" REAL NOT NULL,
    "distance" REAL NOT NULL,
    "vehicle" TEXT NOT NULL,
    CONSTRAINT "Travel_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Travel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Travel" ("averageSpeed", "dateTime", "distance", "id", "maxSpeed", "time", "trackId", "userId", "vehicle") SELECT "averageSpeed", "dateTime", "distance", "id", "maxSpeed", "time", "trackId", "userId", 'CAR' FROM "Travel";
DROP TABLE "Travel";
ALTER TABLE "new_Travel" RENAME TO "Travel";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

