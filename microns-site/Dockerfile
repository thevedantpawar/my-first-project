# Deterministic build for Railway. The repo has several projects in it, so the
# service's root directory must be set to microns-site.
FROM node:22-alpine

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Inlined into the client bundle at build time, so it has to be present here.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_BOOKING_URL
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_BOOKING_URL=$NEXT_PUBLIC_BOOKING_URL \
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN=$NEXT_PUBLIC_PLAUSIBLE_DOMAIN

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT:-3000} -H 0.0.0.0"]
