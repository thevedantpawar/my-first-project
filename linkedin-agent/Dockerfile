# Build and run the LinkedIn content agent.
#
# The API resolves its config and data directories relative to its own source
# file, so the layout under /app must mirror the repository: /app/config,
# /app/data and /app/apps/api/dist.
FROM node:22-alpine

WORKDIR /app

# Install dependencies from the lockfile first so a code change does not
# invalidate the dependency layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN npm ci

COPY . .

RUN npm run build && npm prune --omit=dev

# Run log, authenticity pack, swipe file and analytics live here. Mount a
# volume at /app/data or every redeploy starts from an empty history.
RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
