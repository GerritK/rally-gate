FROM node:22-alpine AS build
WORKDIR /repo

# The lockfile plus *every* workspace manifest, so `npm ci` sees exactly the
# tree the lockfile describes — omitting one makes npm consider the lockfile
# out of sync and refuse. Copied ahead of the sources so this layer caches
# until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/gate-agent/package.json apps/gate-agent/
COPY apps/rally-server/package.json apps/rally-server/
COPY apps/web/package.json apps/web/
# `npm ci` rather than `npm install`: installs strictly from the lockfile, so
# two builds of the same commit resolve identical dependencies.
RUN npm ci

COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/rally-server apps/rally-server
COPY apps/web apps/web
RUN npm run build --workspace=@rally-gate/shared
RUN npm run build --workspace=@rally-gate/rally-server
# The dashboard is served by rally-server itself in headless mode, so it has
# to be built here — packages/ui ships as source and is compiled by web's own
# Vite, which is why it is copied too.
RUN npm run build --workspace=@rally-gate/web

# The build needed nest-cli, typescript, webpack and jest; the runtime does
# not. Pruning here keeps them out of the image copied below.
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/rally-server apps/rally-server
# Static output only — main.ts resolves it as ../../web/dist relative to its
# own compiled location, so the layout has to match the repo's.
COPY --from=build /repo/apps/web/dist apps/web/dist

EXPOSE 57430 57431
CMD ["node", "apps/rally-server/dist/main.js"]
