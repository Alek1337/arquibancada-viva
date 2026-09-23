FROM node:24.14.1-alpine3.23 AS build
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN pnpm install --frozen-lockfile

COPY apps/worker apps/worker
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY packages/storage packages/storage
RUN pnpm --filter @arquibancada-viva/worker build

FROM node:24.14.1-alpine3.23 AS runtime
ENV NODE_ENV=production
ENV WORKER_PROBE_HOST=0.0.0.0
WORKDIR /app

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /workspace/apps/worker/dist ./apps/worker/dist
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/worker/dist/main.js"]
