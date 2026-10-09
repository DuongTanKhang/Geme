FROM node:22-alpine

WORKDIR /app
RUN corepack enable

ARG GEME_API_BASE_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG AEGIS_AUTH_API_URL
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    GEME_API_BASE_URL=${GEME_API_BASE_URL} \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    AEGIS_AUTH_API_URL=${AEGIS_AUTH_API_URL}

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN if [ -z "$GEME_API_BASE_URL" ] || [ -z "$NEXT_PUBLIC_API_BASE_URL" ] || [ -z "$AEGIS_AUTH_API_URL" ]; then \
      echo "Set GEME_API_BASE_URL, NEXT_PUBLIC_API_BASE_URL, and AEGIS_AUTH_API_URL when building the production image." >&2; exit 1; \
    fi \
    && pnpm build

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
