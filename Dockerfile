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

# Install dependencies for Caddy install
RUN apt-get update && apt-get install -y --no-install-recommends \
        debian-keyring \
        debian-archive-keyring \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg && \
    rm -rf /var/lib/apt/lists/*

# Install Caddy via official repo
RUN curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor \
        | tee /usr/share/keyrings/caddy-stable-archive-keyring.gpg > /dev/null && \
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | tee /etc/apt/sources.list.d/caddy-stable.list && \
    apt-get update && \
    apt-get install -y caddy

# Copy app runtime files
COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/index.mjs ./index.mjs
COPY --from=builder /app/src ./src

# Copy Caddy config
COPY Caddyfile /etc/caddy/Caddyfile

# Final port
EXPOSE 3002

CMD ["sh", "-c", "node index.mjs & caddy run --config /etc/caddy/Caddyfile"]
