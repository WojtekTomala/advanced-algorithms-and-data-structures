# syntax=docker/dockerfile:1

# ---------- Etap 1: build aplikacji Angular ----------
FROM node:24-alpine AS build
WORKDIR /app

# Najpierw manifesty zależności (lepsze cache'owanie warstw).
COPY package.json package-lock.json ./
RUN npm ci

# Reszta źródeł + produkcyjny build.
COPY . .
RUN npm run build -- --configuration production

# ---------- Etap 2: serwowanie statycznych plików przez nginx ----------
FROM nginx:1.27-alpine AS runtime

# Konfiguracja z fallbackiem dla routingu SPA.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Statyczny build z etapu 1 (katalog browser/).
COPY --from=build /app/dist/algorithms-app/browser /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
