-- Bootstrap auth email verification and password recovery tables.
-- Safe to run multiple times.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(64),
    ADD COLUMN IF NOT EXISTS last_login_user_agent TEXT,
    ADD COLUMN IF NOT EXISTS verification_email_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS account_email_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_type VARCHAR(32) NOT NULL CHECK (token_type IN ('verify_email', 'reset_password')),
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_ip VARCHAR(64),
    created_user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_account_email_tokens_user_type
    ON account_email_tokens(user_id, token_type);

CREATE INDEX IF NOT EXISTS idx_account_email_tokens_hash
    ON account_email_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_account_email_tokens_expires_at
    ON account_email_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_account_email_tokens_used_at
    ON account_email_tokens(used_at);
