FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/rally-server/package.json apps/rally-server/
RUN npm install

COPY packages/shared packages/shared
COPY apps/rally-server apps/rally-server
RUN npm run build --workspace=@rally-gate/shared
RUN npm run build --workspace=@rally-gate/rally-server

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/rally-server apps/rally-server

EXPOSE 57430 57431
CMD ["node", "apps/rally-server/dist/main.js"]
