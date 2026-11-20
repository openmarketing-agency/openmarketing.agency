# Build the self-hosted Next.js application and run it as a non-root user.
FROM node:24-slim AS oma-tooling

# Native password hashing can fall back to a local build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY oma/package.json oma/package-lock.json ./
RUN npm ci \
    && chown node:node /app \
    && install -d -m 0700 -o node -g node /app/data
COPY --chown=node:node oma/ ./
USER node

FROM oma-tooling AS oma-build
RUN npm run build

FROM node:24-slim AS oma-runtime

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    OMA_DATA_DIR=/app/data \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN install -d -m 0700 -o node -g node /app/data
COPY --from=oma-build --chown=node:node /app/public ./public
COPY --from=oma-build --chown=node:node /app/.next/standalone ./
COPY --from=oma-build --chown=node:node /app/.next/static ./.next/static
COPY --from=oma-build --chown=node:node /app/scripts/compose-startup.cjs ./compose-startup.cjs

USER node
EXPOSE 3000

CMD ["node", "--require", "./compose-startup.cjs", "server.js"]
