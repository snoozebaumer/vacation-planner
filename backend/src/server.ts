import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { waitForDb } from "./db/pool";
import { vacationsRouter } from "./routes/vacations";
import { usersRouter } from "./routes/users";
import { matchupRouter } from "./routes/matchup";
import { rankingRouter } from "./routes/ranking";
import { exportRouter } from "./routes/exportMyMaps";
import { vetoRouter } from "./routes/veto";
import { bucketsRouter, bucketWeightsRouter } from "./routes/bucketWeights";
import { placeSuggestionsRouter } from "./routes/placeSuggestions";
import { requireVacationUnlock } from "./middleware/vacationLock";

const app = express();

// Only ever reached via nginx on the same Docker network (the backend's own
// port is bound to 127.0.0.1 on the host, never exposed directly), so the
// immediate upstream is always trustworthy — safe to read the real client
// IP nginx forwards in X-Forwarded-For (see frontend/nginx.conf) rather than
// the raw socket address, which would just be nginx itself.
app.set("trust proxy", true);

app.use(cors());
app.use(express.json());

// Defense-in-depth against a buggy client or a leaked session hammering the
// API — not the primary access control (Cloudflare Access handles that at
// the edge). Generous enough that even fast back-to-back dueling never gets
// close to it.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Everything under here except the vacation's own metadata (vacationsRouter)
// serves actual trip content, so it all goes through the password gate —
// requireVacationUnlock() is a no-op for vacations that don't have one set.
app.use("/api/place-suggestions", placeSuggestionsRouter);
app.use("/api/vacations", vacationsRouter);
app.use("/api/vacations/:vacationId/users", requireVacationUnlock(), usersRouter);
app.use("/api/vacations/:vacationId/users/:userId", requireVacationUnlock(), matchupRouter);
app.use("/api/vacations/:vacationId/users/:userId", requireVacationUnlock(), vetoRouter);
app.use("/api/vacations/:vacationId/users/:userId", requireVacationUnlock(), bucketWeightsRouter);
app.use("/api/vacations/:vacationId", requireVacationUnlock(), bucketsRouter);
app.use("/api/vacations/:vacationId/ranking", requireVacationUnlock(), rankingRouter);
app.use("/api/vacations/:vacationId/export", requireVacationUnlock(), exportRouter);

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  await waitForDb();
  app.listen(PORT, () => {
    console.log(`VacationPlanner backend listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
