import { createApp } from "./src/app.js";
import { openDb } from "./src/db.js";
import { startScheduler } from "./src/monitor.js";

const db = openDb();
const app = createApp(db);
// Reminders every minute; Rama Judicial checks and reports at 07:00, 13:00 and 17:00 (Colombia).
if (process.env.SCHEDULER !== "0") startScheduler(db);
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`JuanMaApp listening on http://localhost:${port}`));
