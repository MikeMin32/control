FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Schema not present yet — skip postinstall prisma generate (runs in builder).
RUN npm ci --legacy-peer-deps --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Docker image builds use the default `.next` distDir (no concurrent next-dev).
ENV NEXT_DIST_DIR=.next
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_DIST_DIR=.next
ENV PORT=3000
ENV HOST=0.0.0.0
RUN apk add --no-cache wget
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.ts ./next.config.ts

USER nextjs
EXPOSE 3000
# migrate deploy does not run prisma seed — production stays empty until bootstrap:admin
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]
