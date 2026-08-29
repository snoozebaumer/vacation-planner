import { Router } from "express";
import { suggestPlaces } from "../services/placeSuggestions";

// Pre-creation — there's no vacation yet, so no vacationId/unlock gate
// applies here (only the global /api rate limiter does).
export const placeSuggestionsRouter = Router();

placeSuggestionsRouter.post("/", async (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "title is required" });
  }

  const suggestions = await suggestPlaces(title);
  res.json({ suggestions });
});
