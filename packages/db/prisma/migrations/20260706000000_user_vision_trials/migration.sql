-- Premium Vision/LLM auto-field engine free-trial meter, persisted per user.
--
-- Counts how many free trials of the premium (Vision/LLM) auto-field placement
-- engine this account has consumed. The application caps it at 2
-- (VISION_TRIAL_LIMIT) via an atomic guarded increment so the limit can never be
-- exceeded even under concurrent requests. Premium plans (PRO/ENTERPRISE) are
-- unmetered and never consume this counter.
--
-- NOT NULL DEFAULT 0 backfills every existing row to "no trials used yet".
ALTER TABLE "users" ADD COLUMN "vision_trials_used" INTEGER NOT NULL DEFAULT 0;
