-- Realign the product's default display language to English. New users created
-- without an explicit locale now default to 'en'. Existing rows are left
-- untouched, preserving any Korean preference already persisted.
ALTER TABLE "users"
ALTER COLUMN "locale" SET DEFAULT 'en';
