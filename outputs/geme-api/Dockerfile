FROM node:22-alpine

WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm db:generate && pnpm build \
    && mkdir -p dist/generated \
    && cp -R src/generated/prisma dist/generated/prisma

# The build-time placeholder only lets Prisma generate its client. Require the
# real database URL from the deployment environment at runtime.
ENV DATABASE_URL=

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
