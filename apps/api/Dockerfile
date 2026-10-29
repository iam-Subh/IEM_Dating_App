# The API for the server (deploy/docker-compose.prod.yml). Built from the
# repository root, because it uses the workspace's lockfile and @iem-dating/shared:
#   docker compose -f deploy/docker-compose.prod.yml build api
# Works on ARM (AWS t4g, Oracle Ampere) and x86 alike.
FROM node:22-bookworm-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
ENV NODE_ENV=production

# Only what the API needs from the workspace. Every workspace's package.json
# must be present for `npm ci`, but only the API's packages are installed.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/ packages/shared/

# --ignore-scripts skips the root's patch-package (patches for the mobile app,
# whose packages are not here); ffmpeg-static's download is run on its own.
# Dev packages stay: prisma's CLI runs the migrations at start.
RUN npm ci --workspace @iem-dating/api --include=dev --ignore-scripts \
 && npm rebuild ffmpeg-static sharp

COPY apps/api/ apps/api/
WORKDIR /repo/apps/api
RUN npx prisma generate && npx tsc

EXPOSE 3000
# Migrations first (deploy only: never `migrate dev`, `reset` or a shadow
# database against a real one), then the server and its workers.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
