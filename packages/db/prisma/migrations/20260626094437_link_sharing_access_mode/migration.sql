-- CreateEnum
CREATE TYPE "SignRequestAccessMode" AS ENUM ('CODE', 'LINK');

-- AlterTable
ALTER TABLE "sign_requests" ADD COLUMN     "access_mode" "SignRequestAccessMode" NOT NULL DEFAULT 'CODE',
ADD COLUMN     "link_expires_at" TIMESTAMP(3),
ADD COLUMN     "link_label" TEXT,
ADD COLUMN     "link_password_hash" TEXT,
ADD COLUMN     "link_revoked_at" TIMESTAMP(3),
ALTER COLUMN "recipient_email" DROP NOT NULL;
