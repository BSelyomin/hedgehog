FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci

FROM dependencies AS server
COPY tsconfig.json ./
COPY server server
COPY shared shared
RUN npm run build -w server
ENV NODE_ENV=production PORT=4000
USER node
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "server"]

FROM dependencies AS web-build
COPY tsconfig.json ./
COPY web web
COPY shared shared
ENV NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=http://backend:4000
RUN npm run build -w web

FROM web-build AS web
RUN chown -R node:node /app/web/.next
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=http://backend:4000
USER node
EXPOSE 80
CMD ["npm", "run", "start", "-w", "web"]
