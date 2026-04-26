from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone

from .models import AccountEmailToken, User


VERIFY_EMAIL = "verify_email"
RESET_PASSWORD = "reset_password"


def generate_raw_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def mark_existing_tokens_used(user: User, token_type: str) -> None:
    AccountEmailToken.objects.filter(user=user, token_type=token_type, used_at__isnull=True).update(used_at=timezone.now())


def issue_email_token(
    user: User,
    token_type: str,
    *,
    created_ip: str | None = None,
    created_user_agent: str | None = None,
    expires_in_minutes: int = 60,
) -> str:
    raw_token = generate_raw_token()
    mark_existing_tokens_used(user, token_type)
    AccountEmailToken.objects.create(
        user=user,
        token_type=token_type,
        token_hash=hash_token(raw_token),
        expires_at=timezone.now() + timedelta(minutes=expires_in_minutes),
        used_at=None,
        created_at=timezone.now(),
        created_ip=created_ip,
        created_user_agent=created_user_agent,
    )
    return raw_token


def consume_email_token(raw_token: str, token_type: str) -> AccountEmailToken | None:
    now = timezone.now()
    token = (
        AccountEmailToken.objects.select_related("user")
        .filter(
            token_hash=hash_token(raw_token),
            token_type=token_type,
            used_at__isnull=True,
            expires_at__gt=now,
        )
        .order_by("-created_at")
        .first()
    )
    if not token:
        return None

    token.used_at = now
    token.save(update_fields=["used_at"])
    return token
