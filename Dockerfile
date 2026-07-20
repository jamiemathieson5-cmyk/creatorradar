# CreatorRadar — Railway-friendly image with Chromium for TikTok feed scrape.
# TikLeap is NOT required in production (SCRAPE_MODE=tiktok_feed default).
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    SCRAPE_MODE=tiktok_feed \
    NODE_ENV=production \
    PORT=8787

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Point browser launchers at system Chromium
ENV CHROME_PATH=/usr/bin/chromium \
    LEAD_FINDER_CHROME_PATH=/usr/bin/chromium \
    LEAD_FINDER_CHROME=/usr/bin/chromium \
    GOOGLE_CHROME_BIN=/usr/bin/chromium \
    LEAD_FINDER_CHROME_NO_SANDBOX=1

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Persist leads/users/sessions via a Railway volume mounted at /app/data
# (do not use Dockerfile VOLUME — Railway rejects it; attach volume in dashboard/CLI)
RUN mkdir -p /app/data

EXPOSE 8787
CMD ["node", "server/index.js"]
