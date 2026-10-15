import cron from "node-cron";
import { prisma } from "./utils";
import { dailyQuests } from "./quests";
import { removeOrphanFiles } from "./files";

export async function assignDailyQuests() {
  const users = await prisma.user.findMany({ select: { id: true, vehicles: { select: { vehicle: true } } } });

  for (const user of users) {
    const quests = dailyQuests(user.vehicles.map((v) => v.vehicle)).map((q) => ({ ...q, userId: user.id }));
    await prisma.$transaction([
      prisma.quest.deleteMany({ where: { userId: user.id } }),
      prisma.quest.createMany({ data: quests }),
    ]);
  }
}

export default function initCronJob() {
  cron.schedule("0 0 * * *", async () => {
    console.log("Cron Executing..");

    try {
      await assignDailyQuests();
      console.log("Daily quests assigned to each user!");
    } catch (error) {
      console.error("Error while updating quests:", error);
    }
  });

  cron.schedule("30 3 * * *", async () => {
    try {
      const removed = await removeOrphanFiles();
      if (removed > 0) console.log(`Removed ${removed} files left from deleted rows`);
    } catch (error) {
      console.error("Error while removing orphan files:", error);
    }
  });
}
