# For dev/demo use only (docker-compose.dev.yml, simulated adapter).
# Real gate deployments on a Pi run this directly via a systemd unit instead,
# since the OpenStint/RCHourglass adapters need raw USB/SDR device access
# that's awkward to pass through a container.
FROM node:24-alpine AS build
WORKDIR /repo

# See apps/rally-server/Dockerfile for why every workspace manifest and the
# lockfile are copied before the sources.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/gate/package.json apps/gate/
COPY apps/rally-server/package.json apps/rally-server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared packages/shared
COPY apps/gate apps/gate
RUN npm run build --workspace=@rally-gate/shared
# The Node code only: the settings page needs packages/ui and Vite, and a
# simulated agent has no use for it.
RUN npx --workspace=@rally-gate/gate tsc -p tsconfig.json

RUN npm prune --omit=dev

FROM node:24-alpine
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/gate apps/gate

CMD ["node", "apps/gate/dist/agent/main.js"]
