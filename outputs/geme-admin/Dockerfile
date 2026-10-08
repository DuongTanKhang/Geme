FROM node:22-alpine

WORKDIR /workspace/outputs
RUN corepack enable

COPY . .

WORKDIR /workspace/outputs/geme-admin
RUN pnpm install --frozen-lockfile

EXPOSE 3001
CMD ["pnpm", "dev"]
