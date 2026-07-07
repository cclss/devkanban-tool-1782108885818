# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# API image for @repo/api (NestJS).
#
# The runtime stage bundles LibreOffice headless (`soffice`) so uploaded `.docx`
# contracts can be converted to PDF in-process, plus Nanum fonts so Korean
# (Hangul) layouts render correctly in the converted PDF.
# ---------------------------------------------------------------------------

# --- Build: install workspace deps and compile the API ----------------------
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

# Copy the whole monorepo (pnpm workspace) and build only the API + its deps.
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @repo/db db:generate \
 && pnpm --filter @repo/api build

# --- Runtime: Node + LibreOffice headless -----------------------------------
FROM node:20-bookworm-slim AS runtime

# `libreoffice-writer` pulls in `soffice` (via libreoffice-core); `--no-install-
# recommends` keeps the GUI stack out. `fonts-nanum` supplies Hangul glyphs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      fonts-nanum \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Where the converter finds soffice inside this image.
ENV LIBREOFFICE_BIN=/usr/bin/soffice

RUN corepack enable
WORKDIR /app

# Bring over the installed deps, generated Prisma client, and compiled output.
COPY --from=build /app ./

EXPOSE 3001
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
