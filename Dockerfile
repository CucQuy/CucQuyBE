# ── Build ──
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# nest build copy assets (**/*.md) đôi khi bỏ sót → copy tay đảm bảo mọi prompt .md có trong dist.
RUN npm run build \
 && cd src && find . -name '*.md' | while read -r f; do \
      mkdir -p "../dist/$(dirname "$f")" && cp "$f" "../dist/$f"; \
    done

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
