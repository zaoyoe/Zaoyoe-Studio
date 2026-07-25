FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg

RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci --omit=dev

COPY adapters ./adapters
COPY api ./api
COPY server ./server
COPY js ./js
COPY scripts ./scripts
COPY docs ./docs
COPY supabase ./supabase

EXPOSE 3001
CMD ["node", "server/index.js"]
