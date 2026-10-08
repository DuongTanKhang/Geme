FROM node:22-alpine

WORKDIR /app
RUN corepack enable
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm db:generate && pnpm build \
    && mkdir -p dist/generated \
    && cp -R src/generated/prisma dist/generated/prisma

EXPOSE 4000
CMD ["pnpm", "start"]
