-- CreateTable
CREATE TABLE "UserVehicle" (
    "userId" INTEGER NOT NULL,
    "vehicle" TEXT NOT NULL,

    PRIMARY KEY ("userId", "vehicle"),
    CONSTRAINT "UserVehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Every existing user starts with all four vehicles, as new users do
INSERT INTO "UserVehicle" ("userId", "vehicle")
SELECT "id", "vehicle" FROM "User"
CROSS JOIN (SELECT 'CAR' AS "vehicle" UNION ALL SELECT 'MOTORCYCLE' UNION ALL SELECT 'BICYCLE' UNION ALL SELECT 'FOOT');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Quest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "experience" INTEGER NOT NULL,
    "maxProgress" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    CONSTRAINT "Quest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Today's quests count car travels until the next daily ones replace them
INSERT INTO "new_Quest" ("description", "experience", "id", "maxProgress", "progress", "type", "userId", "vehicle") SELECT "description", "experience", "id", "maxProgress", "progress", "type", "userId", 'CAR' FROM "Quest";
DROP TABLE "Quest";
ALTER TABLE "new_Quest" RENAME TO "Quest";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

