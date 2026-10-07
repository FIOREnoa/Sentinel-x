# =========================
# Étape 1 : construction du dashboard React
# =========================
FROM node:22-alpine AS frontend-build

WORKDIR /app

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
# Aucun secret ici : le dashboard s'authentifie par cookie de session (/api/v1/login)
RUN npm run build


# =========================
# Étape 2 : Nginx
# =========================
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html
# Les certificats ne sont pas copiés dans l'image : le docker compose les monte en lecture seule
