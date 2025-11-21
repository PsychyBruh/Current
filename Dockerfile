# ============================
# Stage 1: Build with Bun
# ============================
FROM oven/bun:latest AS builder

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN bun install

# Copy all files
COPY . .

# Build your dist folder
RUN bun run build

# ============================
# Stage 2: Runtime with Node + Caddy
# ============================
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install CA certificates + curl for installing Caddy
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Install Caddy reverse proxy
RUN curl -fsSL https://getcaddy.com | bash -s personal

# Copy runtime files only
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

# Start both Node (Current + Epoxy) AND Caddy
CMD ["sh", "-c", "node index.mjs & caddy run --config /etc/caddy/Caddyfile"]
