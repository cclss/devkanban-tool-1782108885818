-- Service-wide branding singleton. One row (id = 'GLOBAL') holds the logo and
-- favicon storage keys + their stored MIME types, plus the primary brand color.
-- Nullable throughout so an unconfigured service falls back to built-in defaults.
-- CreateTable
CREATE TABLE "branding_settings" (
    "id" TEXT NOT NULL DEFAULT 'GLOBAL',
    "logo_storage_key" TEXT,
    "logo_content_type" TEXT,
    "favicon_storage_key" TEXT,
    "favicon_content_type" TEXT,
    "brand_color" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branding_settings_pkey" PRIMARY KEY ("id")
);
