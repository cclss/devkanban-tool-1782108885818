-- Persist each signed-in user's preferred application language. Existing users
-- retain the Korean product default when this migration is applied.
CREATE TYPE "Locale" AS ENUM ('ko', 'en');

ALTER TABLE "users"
ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'ko';
