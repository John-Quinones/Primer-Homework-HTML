import { createApp } from "./src/app.js";
import { openDb } from "./src/db.js";

const app = createApp(openDb());
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`JuanMaApp listening on http://localhost:${port}`));
