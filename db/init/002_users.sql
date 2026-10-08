CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user'
                  CHECK (role IN ('admin', 'user')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_username_idx
    ON users (username);

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE users
TO sentinel_app;

GRANT USAGE, SELECT, UPDATE
ON SEQUENCE users_id_seq
TO sentinel_app;