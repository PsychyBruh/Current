# ============================
# Stage 1: Build with Bun
# ============================
FROM oven/bun:latest AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY . .
RUN bun run build

# ============================
# Stage 2: Runtime with Node + Caddy
# ============================
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install CA certs + curl + gnupg for apt repo
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg && \
    rm -rf /var/lib/apt/lists/*

# Install Caddy from official apt repo
RUN curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable.gpg && \
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && \
    apt-get update && \
    apt-get install -y caddy

# Copy runtime files
COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/index.mjs ./index.mjs
COPY --from=builder /app/src ./src

# Copy Caddy config
COPY Caddyfile /etc/caddy/Caddyfile

# Expose only the combined port
EXPOSE 3002

# Start Node & Caddy
CMD ["sh", "-c", "node index.mjs & caddy run --config /etc/caddy/Caddyfile"]
