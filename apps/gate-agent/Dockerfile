# For dev/demo use only (docker-compose.dev.yml, simulated adapter).
# Real gate deployments on a Pi run this directly via a systemd unit instead,
# since the OpenStint/RCHourglass adapters need raw USB/SDR device access
# that's awkward to pass through a container.
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/gate-agent/package.json apps/gate-agent/
RUN npm install

COPY packages/shared packages/shared
COPY apps/gate-agent apps/gate-agent
RUN npm run build --workspace=@rally-gate/shared
RUN npm run build --workspace=@rally-gate/gate-agent

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/gate-agent apps/gate-agent

CMD ["node", "apps/gate-agent/dist/main.js"]
