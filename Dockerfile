# ============================
# Stage 1: Build with Bun
# ============================
FROM oven/bun:latest AS builder

WORKDIR /app

# Install dependencies (Bun reads package.json)
COPY package.json ./
RUN bun install

# Copy the rest of the source code
COPY . .

# Build static assets into /dist using your build script
# (runs: "bun build.mjs" as defined in package.json)
RUN bun run build

# ============================
# Stage 2: Runtime (Node)
# ============================
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Basic OS deps (certs, etc.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy only what the server actually needs at runtime
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/index.mjs ./index.mjs
# src is only used in dev mode, but copying doesn't hurt and keeps 404/index fallbacks handy
COPY --from=builder /app/src ./src

# If you ever add extra runtime files (ecosystem.config.cjs, ask.js, etc.),
# you can copy them the same way:
# COPY --from=builder /app/ecosystem.config.cjs ./ecosystem.config.cjs

EXPOSE 3000

# Use Node directly so we don't depend on pino-pretty or bash/ENV tricks
CMD ["node", "index.mjs"]
