-- VacationPlanner schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Lifecycle: draft (places/trip-prefs being collected collaboratively, no
-- research yet) -> creating (research/classification running) -> ready |
-- failed. active_hours_per_day/avg_travel_time_hours are NULL through
-- draft — they're filled in at start-ranking time from the median of
-- vacation_trip_prefs, not collected at creation anymore.
CREATE TABLE vacations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    duration_days   NUMERIC NOT NULL,
    active_hours_per_day NUMERIC,
    avg_travel_time_hours NUMERIC,
    status          TEXT NOT NULL DEFAULT 'draft', -- draft | creating | ready | failed
    places_total    INTEGER NOT NULL DEFAULT 0,
    places_processed INTEGER NOT NULL DEFAULT 0,
    avg_place_process_seconds NUMERIC,
    location_context TEXT, -- smallest common location for all places (e.g. "Bern"), re-inferred each research batch
    password_hash   TEXT, -- "salt:hash" (scrypt), NULL = not password-protected
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A vacation's places are sorted into a small set of "buckets" (e.g. Eating
-- & Drinking, Museums & Culture) so ranking only ever compares like with
-- like. Buckets are classified per-vacation from a curated pool (see
-- services/bucketClassifier.ts) — a pool bucket only gets a row here if at
-- least one of this vacation's places was actually assigned to it, and the
-- classifier may mint an extra bucket (is_generated = true) for places that
-- genuinely fit none of the pool.
CREATE TABLE buckets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_id     UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    name_en         TEXT NOT NULL,
    name_de         TEXT NOT NULL,
    is_generated    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vacation_id, key)
);

CREATE INDEX idx_buckets_vacation ON buckets(vacation_id);

CREATE TABLE places (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_id     UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    bucket_id       UUID REFERENCES buckets(id),
    elo_rating      NUMERIC NOT NULL DEFAULT 400,
    estimated_hours NUMERIC,
    research_status TEXT NOT NULL DEFAULT 'pending', -- pending | researching | done | failed
    research_source TEXT, -- official_site | reddit_forum | fallback
    photo_url       TEXT,
    photo_aspect_ratio NUMERIC,
    photo_status    TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- (3) = millisecond precision, matching JS Date/JSON round-trip exactly —
    -- the frontend round-trips this value back in PATCH requests as an
    -- optimistic-concurrency guard, and a plain TIMESTAMPTZ's microsecond
    -- precision would silently never compare equal after that round-trip.
    updated_at      TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX idx_places_vacation ON places(vacation_id);
CREATE INDEX idx_places_bucket ON places(bucket_id);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_id     UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vacation_id, name)
);

CREATE INDEX idx_users_vacation ON users(vacation_id);

-- Tracks which places a user has already faced in the current round.
-- A round resets (row deleted) once every place in the vacation has been seen.
CREATE TABLE user_round_seen (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_id        UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, place_id)
);

CREATE TABLE matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_id     UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    winner_place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    loser_place_id  UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    winner_elo_before NUMERIC NOT NULL,
    loser_elo_before  NUMERIC NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_matches_vacation ON matches(vacation_id);
CREATE INDEX idx_matches_user ON matches(user_id);

-- A user's single active veto for a vacation, pinning one place to the top
-- of the ranking regardless of budget fit. The (vacation_id, user_id)
-- primary key is what enforces "at most one veto at a time" — setting a new
-- veto is an upsert that replaces any existing row for that user.
CREATE TABLE vetoes (
    vacation_id     UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_id        UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vacation_id, user_id)
);

CREATE INDEX idx_vetoes_place ON vetoes(place_id);

-- Each user weighs how much of the trip's total time budget should go to
-- each bucket (sliders that must add up to 100%, enforced in the API layer
-- since it spans multiple rows). A bucket's actual time budget is the
-- MEDIAN weight across every user who has submitted, computed on read
-- (services/rankingCalc.ts) rather than stored, so it stays live as people
-- change their minds.
CREATE TABLE bucket_weights (
    vacation_id     UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bucket_id       UUID NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
    weight_pct      NUMERIC NOT NULL CHECK (weight_pct >= 0 AND weight_pct <= 100),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vacation_id, user_id, bucket_id)
);

CREATE INDEX idx_bucket_weights_lookup ON bucket_weights(vacation_id, user_id);

-- Same shape/idea as bucket_weights, but for the two trip-pacing knobs that
-- used to be fixed at creation time. Draft-phase only (see routes/tripPrefs.ts)
-- — the median across whoever submitted becomes vacations.active_hours_per_day
-- / avg_travel_time_hours at start-ranking time. Anyone who joins after
-- ranking has started never gets a row here, matching "no say" for latecomers.
CREATE TABLE vacation_trip_prefs (
    vacation_id            UUID NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
    user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_hours_per_day   NUMERIC NOT NULL,
    avg_travel_time_hours  NUMERIC NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vacation_id, user_id)
);
