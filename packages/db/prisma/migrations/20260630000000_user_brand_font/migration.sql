-- CreateEnum
CREATE TYPE "BrandFont" AS ENUM ('SANS', 'SERIF', 'SCRIPT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "brand_font" "BrandFont";
