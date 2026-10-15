// first, so modules that read env at load see .env
import "dotenv/config";
import app from "./app.js";
import initCronJob from "./cronJob.js";
import { scheduleCachePruning } from "./routing/data/diskCache.js";

const PORT = process.env.PORT;
if (!PORT) throw ("PORT is required");

// initializing cron job for quests
initCronJob();
scheduleCachePruning();

app.listen(PORT, (error) => {
    if (error) {
        console.error(error);
        process.exit(1);
    }
    console.log(`Server has started on http://localhost:${PORT}`);
})
