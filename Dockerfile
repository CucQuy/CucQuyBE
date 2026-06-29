# ── Build ──
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ── Run ──
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# SQL nguồn cho bộ migrate lúc khởi động (dist/migrate.js đọc /app/migrations).
COPY --from=build /app/migrations ./migrations
EXPOSE 3000
# Tự đồng bộ DB (migration đánh số + stored function) TRƯỚC khi app boot.
CMD ["sh", "-c", "node dist/migrate.js && node dist/main.js"]
