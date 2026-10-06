-- Exécuté une seule fois, à la création du volume de la base

CREATE TABLE telemetry (
    id          BIGSERIAL PRIMARY KEY,
    device_id   TEXT        NOT NULL,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    temperature DOUBLE PRECISION,
    humidity    DOUBLE PRECISION,
    gas         INTEGER,
    motion      BOOLEAN,
    rssi        INTEGER
);
CREATE INDEX telemetry_device_ts ON telemetry (device_id, ts DESC);

CREATE TABLE alerts (
    id              BIGSERIAL PRIMARY KEY,
    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    source          TEXT        NOT NULL,
    device_id       TEXT        NOT NULL,
    type            TEXT        NOT NULL,
    severity        TEXT        NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    zone            TEXT,
    details         JSONB       NOT NULL DEFAULT '{}',
    snapshot        TEXT,
    acknowledged    BOOLEAN     NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ
);
CREATE INDEX alerts_ts ON alerts (ts DESC);

CREATE TABLE commands (
    id        BIGSERIAL PRIMARY KEY,
    ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id TEXT        NOT NULL,
    target    TEXT        NOT NULL,
    action    TEXT        NOT NULL,
    params    JSONB       NOT NULL DEFAULT '{}'
);
