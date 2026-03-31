import "source-map-support/register.js";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "API server started");
});
