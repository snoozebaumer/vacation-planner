import { Router, RequestHandler } from "express";
import { computeRanking } from "../services/rankingCalc";

export const rankingRouter = Router({ mergeParams: true });

type VacationParams = { vacationId: string };

const getRanking: RequestHandler<VacationParams> = async (req, res) => {
  const forUserId = typeof req.query.userId === "string" ? req.query.userId : null;
  const result = await computeRanking(req.params.vacationId, forUserId);
  if (!result) return void res.status(404).json({ error: "Vacation not found" });
  res.json(result);
};

rankingRouter.get("/", getRanking);
