FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY api ./api
COPY server ./server
COPY js ./js
COPY scripts ./scripts
COPY docs ./docs
COPY supabase ./supabase

EXPOSE 3001
CMD ["node", "server/index.js"]
