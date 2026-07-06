-- Store share-link passwords as reversible ciphertext (AES-256-GCM envelope)
-- instead of a one-way bcrypt hash, so the sender can review and edit them.
--
-- Rename-in-place preserves every existing row: pre-existing values remain a
-- legacy bcrypt hash and stay verifiable (the app's verify path detects the
-- envelope prefix and falls back to hash-compare for legacy values). New and
-- updated links are written as `encv1:<iv>:<tag>:<ciphertext>`.
ALTER TABLE "sign_requests" RENAME COLUMN "link_password_hash" TO "link_password_cipher";
