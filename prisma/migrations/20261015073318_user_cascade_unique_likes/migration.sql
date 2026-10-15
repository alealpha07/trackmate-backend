-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FriendRequest" (
    "senderId" INTEGER NOT NULL,
    "receiverId" INTEGER NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "FriendRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FriendRequest_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FriendRequest" ("receiverId", "senderId", "status") SELECT "receiverId", "senderId", "status" FROM "FriendRequest";
DROP TABLE "FriendRequest";
ALTER TABLE "new_FriendRequest" RENAME TO "FriendRequest";
CREATE UNIQUE INDEX "FriendRequest_senderId_receiverId_key" ON "FriendRequest"("senderId", "receiverId");
CREATE TABLE "new_Like" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Like_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- keep one row per user and post, the unique index needs it
INSERT INTO "new_Like" ("id", "postId", "userId") SELECT MIN("id"), "postId", "userId" FROM "Like" GROUP BY "userId", "postId";
DROP TABLE "Like";
ALTER TABLE "new_Like" RENAME TO "Like";
CREATE UNIQUE INDEX "Like_userId_postId_key" ON "Like"("userId", "postId");
CREATE TABLE "new_Quest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "experience" INTEGER NOT NULL,
    "maxProgress" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    CONSTRAINT "Quest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Quest" ("description", "experience", "id", "maxProgress", "progress", "type", "userId", "vehicle") SELECT "description", "experience", "id", "maxProgress", "progress", "type", "userId", "vehicle" FROM "Quest";
DROP TABLE "Quest";
ALTER TABLE "new_Quest" RENAME TO "Quest";
CREATE TABLE "new_Save" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    CONSTRAINT "Save_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Save_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- keep one row per user and post, the unique index needs it
INSERT INTO "new_Save" ("id", "postId", "userId") SELECT MIN("id"), "postId", "userId" FROM "Save" GROUP BY "userId", "postId";
DROP TABLE "Save";
ALTER TABLE "new_Save" RENAME TO "Save";
CREATE UNIQUE INDEX "Save_userId_postId_key" ON "Save"("userId", "postId");
CREATE TABLE "new_Track" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    CONSTRAINT "Track_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Track" ("id", "name", "userId", "vehicle") SELECT "id", "name", "userId", "vehicle" FROM "Track";
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
    CONSTRAINT "Travel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Travel" ("averageSpeed", "dateTime", "distance", "id", "maxSpeed", "time", "trackId", "userId", "vehicle") SELECT "averageSpeed", "dateTime", "distance", "id", "maxSpeed", "time", "trackId", "userId", "vehicle" FROM "Travel";
DROP TABLE "Travel";
ALTER TABLE "new_Travel" RENAME TO "Travel";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
