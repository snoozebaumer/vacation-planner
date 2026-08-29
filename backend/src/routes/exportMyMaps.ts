import { Router, RequestHandler } from "express";
import { computeRanking, RankedPlaceRow } from "../services/rankingCalc";

export const exportRouter = Router({ mergeParams: true });

type VacationParams = { vacationId: string };

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildCsv(places: RankedPlaceRow[], locationContext: string | null): string {
  const header = ["Name", "Location", "Description"].map(csvField).join(",");
  const rows = places.map((p) => {
    const location = locationContext ? `${p.name}, ${locationContext}` : p.name;
    return [csvField(p.name), csvField(location), csvField(p.description ?? "")].join(",");
  });
  return [header, ...rows].join("\r\n");
}

const getMyMapsExport: RequestHandler<VacationParams> = async (req, res) => {
  const result = await computeRanking(req.params.vacationId);
  if (!result) return void res.status(404).json({ error: "Vacation not found" });

  const lang = req.query.lang === "de" ? "de" : "en";

  // Only places confirmed to fit within their bucket's time budget (strictly
  // before that bucket's cutoff line) — places without a duration estimate
  // can't be confirmed either way, so they're excluded rather than guessed at.
  const categories = result.buckets
    .map((bucket) => {
      const places = bucket.places.filter((p) => p.fitsInBudget === true);
      const label = lang === "de" ? bucket.nameDe : bucket.nameEn;
      return { key: bucket.bucketKey, label, count: places.length, csv: buildCsv(places, result.vacation.locationContext) };
    })
    .filter((c) => c.count > 0);

  res.json({ vacationName: result.vacation.name, categories });
};

exportRouter.get("/mymaps", getMyMapsExport);
