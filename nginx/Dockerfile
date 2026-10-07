# =========================
# Étape 1 : build React
# =========================
FROM node:22-alpine AS frontend-build

WORKDIR /app

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ .

# Récupère automatiquement DASHBOARD_TOKEN depuis docker-compose
ARG VITE_DASHBOARD_TOKEN
ENV VITE_DASHBOARD_TOKEN=${VITE_DASHBOARD_TOKEN}

RUN npm run build


# =========================
# Étape 2 : Nginx
# =========================
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf

COPY --from=frontend-build /app/dist /usr/share/nginx/html

COPY certs/server.crt /etc/nginx/certs/server.crt
COPY certs/server.key /etc/nginx/certs/server.key