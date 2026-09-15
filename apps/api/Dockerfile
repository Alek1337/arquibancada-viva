FROM node:24.14.1-alpine3.23 AS build
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/auth packages/auth
COPY packages/config packages/config
COPY packages/database packages/database
RUN pnpm --filter @arquibancada-viva/api build

FROM node:24.14.1-alpine3.23 AS runtime
ENV API_HOST=0.0.0.0
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
