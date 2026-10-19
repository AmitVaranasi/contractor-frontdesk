import { beforeEach } from "vitest";
import { resetDbConnection } from "../lib/storage/db";

// Tests always run offline against the deterministic rules path and an in-memory database.
for (const k of ["ROCKETRIDE_APIKEY", "ANTHROPIC_API_KEY", "FLATKEY_API_KEY", "CELESTO_API_KEY", "MASKY_API_KEY", "N8N_WEBHOOK_URL"]) delete process.env[k];
process.env.DB_PATH = ":memory:";

beforeEach(() => resetDbConnection());
