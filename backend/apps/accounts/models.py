from django.db import models

from apps.common.auth import hash_password, verify_password


class User(models.Model):
    id = models.BigAutoField(primary_key=True)
    username = models.CharField(max_length=50, unique=True)
    email = models.EmailField(max_length=100, unique=True)
    password_hash = models.CharField(max_length=255)
    full_name = models.CharField(max_length=255, null=True, blank=True)
    role = models.CharField(max_length=20, default="user")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField()
    last_login = models.DateTimeField(null=True, blank=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    last_login_ip = models.CharField(max_length=64, null=True, blank=True)
    last_login_user_agent = models.TextField(null=True, blank=True)
    verification_email_sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "users"
        managed = False

    def set_password(self, plain_text: str) -> None:
        self.password_hash = hash_password(plain_text)

    def check_password(self, plain_text: str) -> bool:
        return verify_password(plain_text, self.password_hash)

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False


class AccountEmailToken(models.Model):
    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column="user_id")
    token_type = models.CharField(max_length=32)
    token_hash = models.CharField(max_length=255)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    created_ip = models.CharField(max_length=64, null=True, blank=True)
    created_user_agent = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "account_email_tokens"
        managed = False
