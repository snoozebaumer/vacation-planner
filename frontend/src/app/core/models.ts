export interface Vacation {
  id: string;
  name: string;
  duration_days: number;
  active_hours_per_day: number;
  avg_travel_time_hours: number;
  status: 'creating' | 'ready' | 'failed';
  places_total: number;
  places_processed: number;
  avg_place_process_seconds: number | null;
  created_at: string;
  eta_seconds?: number | null;
  hasPassword: boolean;
  first_user_name: string | null;
}

export interface VacationUser {
  id: string;
  vacation_id: string;
  name: string;
  created_at: string;
}

export interface MatchupPlace {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  photo_status: 'pending' | 'done' | 'failed';
  estimated_hours: number | null;
}

export interface BucketRef {
  id: string;
  nameEn: string;
  nameDe: string;
}

export interface MatchupResponse {
  places: [MatchupPlace, MatchupPlace];
  bucket: BucketRef | null;
}

export interface Bucket extends BucketRef {
  key: string;
  isGenerated: boolean;
  exampleImageUrl: string | null;
}

export interface BucketWeight {
  bucketId: string;
  weightPct: number;
}

export interface FavoriteBadge {
  userId: string;
  userName: string;
  icon: string;
}

export interface VetoInfo {
  userId: string;
  userName: string;
}

export interface RankedPlace {
  id: string;
  name: string;
  description: string | null;
  elo_rating: number;
  estimated_hours: number | null;
  photo_url: string | null;
  photo_status: 'pending' | 'done' | 'failed';
  research_status: string;
  rank: number;
  fitsInBudget: boolean | null;
  cumulativeHoursAfter: number;
  favoritesOf: FavoriteBadge[];
  vetoedBy: VetoInfo[];
}

export interface UserRankingPlace {
  id: string;
  name: string;
  photo_url: string | null;
  eloRating: number;
  rank: number;
}

export interface UserRankingBucket {
  bucketId: string;
  nameEn: string;
  nameDe: string;
  places: UserRankingPlace[];
}

export interface UserRanking {
  userId: string;
  userName: string;
  matchCount: number;
  buckets: UserRankingBucket[];
}

export interface BudgetAdjustment {
  otherBucketId: string;
  otherBucketNameEn: string;
  otherBucketNameDe: string;
  hours: number;
}

export interface BucketRanking {
  bucketId: string;
  bucketKey: string;
  nameEn: string;
  nameDe: string;
  budgetHours: number;
  cutoffIndex: number | null;
  places: RankedPlace[];
  budgetAdjustments: BudgetAdjustment[];
}

export interface RankingResponse {
  vacation: {
    id: string;
    name: string;
    durationDays: number;
    activeHoursPerDay: number;
    avgTravelTimeHours: number;
    budgetHours: number;
  };
  buckets: BucketRanking[];
  userRankings: UserRanking[];
  myVeto: { placeId: string } | null;
}

export interface MyMapsExportCategory {
  key: string;
  label: string;
  count: number;
  csv: string;
}

export interface MyMapsExportResponse {
  vacationName: string;
  categories: MyMapsExportCategory[];
}
