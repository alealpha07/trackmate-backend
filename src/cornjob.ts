import cron from "node-cron";
import { prisma } from "./utils";
import { QuestType } from "@prisma/client";

function generateQuests() {
  const quests: {
    description: string;
    experience: number;
    maxProgress: number;
    type: QuestType;
  }[] = [];

  const travelSteps = [5, 10, 20, 50];
  const navigateSteps = [3, 5, 10, 20];
  const recordSteps = [1, 5, 10, 15];

  for (const km of travelSteps) {
    quests.push({
      description: `Viaggia ${km} km`,
      experience: km * 20,
      maxProgress: km,
      type: "TRAVEL_DISTANCE",
    });
  }

  for (const count of navigateSteps) {
    quests.push({
      description: `Percorri ${count} tracciati`,
      experience: count * 25,
      maxProgress: count,
      type: "NAVIGATE_TRACK",
    });
  }

  for (const count of recordSteps) {
    quests.push({
      description: `Registra ${count} tracciati`,
      experience: count * 30,
      maxProgress: count,
      type: "RECORD_TRACK",
    });
  }

  return quests;
}

function getRandomQuests(all: any[], n: number) {
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export default function initCronJob() {
  cron.schedule("0 0 * * *", async () => {
    console.log("Cron Executing..");

    try {
      const users = await prisma.user.findMany({ select: { id: true } });

      const allQuests = generateQuests();

      for (const user of users) {
        await prisma.quest.deleteMany({
          where: { userId: user.id },
        });

        const randomQuests = getRandomQuests(allQuests, 3);

        const questsToCreate = randomQuests.map((q) => ({
          userId: user.id,
          description: q.description,
          experience: q.experience,
          maxProgress: q.maxProgress,
          progress: 0,
          type: q.type,
        }));

        await prisma.quest.createMany({
          data: questsToCreate,
        });
      }

      console.log("3 quest randomly generated and assigned to each user!");
    } catch (error) {
      console.error("Error while updating quests:", error);
    }
  });
}
