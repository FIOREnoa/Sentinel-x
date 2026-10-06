#!/bin/sh
# Compte utilisé par l'API : droits limités au strict nécessaire (pas de DROP, pas de DELETE)
set -e
psql -v ON_ERROR_STOP=1 -v app_pwd="$DB_APP_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" << 'SQL'
CREATE ROLE sentinel_app LOGIN PASSWORD :'app_pwd';
GRANT CONNECT ON DATABASE sentinel TO sentinel_app;
GRANT USAGE ON SCHEMA public TO sentinel_app;
GRANT SELECT, INSERT ON telemetry, commands TO sentinel_app;
GRANT SELECT, INSERT, UPDATE (acknowledged, acknowledged_at) ON alerts TO sentinel_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sentinel_app;
SQL
