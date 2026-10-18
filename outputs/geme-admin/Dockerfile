FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

ARG NEXT_PUBLIC_API_BASE_URL
ARG GEME_STOREFRONT_ASSETS_URL
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001 \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    GEME_STOREFRONT_ASSETS_URL=${GEME_STOREFRONT_ASSETS_URL}

RUN if [ -z "$NEXT_PUBLIC_API_BASE_URL" ] || [ -z "$GEME_STOREFRONT_ASSETS_URL" ]; then \
      echo "Set NEXT_PUBLIC_API_BASE_URL and GEME_STOREFRONT_ASSETS_URL when building the production image." >&2; exit 1; \
    fi \
    && pnpm build

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/login').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
