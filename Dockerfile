FROM node:20-slim AS base

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY prisma ./prisma/
COPY src ./src/
COPY public ./public/
COPY scripts ./scripts/

# Generate Prisma client
RUN npx prisma generate

# Expose port (Railway injects PORT env var)
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/sistema/api/v1/health/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run migrations then start server
CMD ["node", "scripts/start-production.js"]
