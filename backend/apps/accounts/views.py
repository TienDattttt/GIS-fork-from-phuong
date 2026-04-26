from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.activity.models import ActivityLog
from apps.common.auth import generate_token
from apps.common.responses import fail, ok

from .email_service import send_password_changed_email, send_reset_password_email, send_verification_email
from .models import User
from .serializers import (
    ForgotPasswordSerializer,
    LoginSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    ResetPasswordSerializer,
    VerifyEmailSerializer,
)
from .token_service import RESET_PASSWORD, VERIFY_EMAIL, consume_email_token, issue_email_token


VERIFY_EMAIL_MINUTES = 60 * 24
RESET_PASSWORD_MINUTES = 60


def _user_payload(user: User):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "fullName": user.full_name,
        "role": user.role,
        "emailVerifiedAt": user.email_verified_at,
    }


def _client_ip(request) -> str | None:
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _log_activity(request, user_id: int, activity_type: str, details: dict | None = None) -> None:
    try:
        ActivityLog.create(
            user_id=user_id,
            activity_type=activity_type,
            page="auth",
            details=details or {},
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
        )
    except Exception:
        pass


def _send_verification_for_user(user: User, request) -> bool:
    raw_token = issue_email_token(
        user,
        VERIFY_EMAIL,
        created_ip=_client_ip(request),
        created_user_agent=request.headers.get("User-Agent"),
        expires_in_minutes=VERIFY_EMAIL_MINUTES,
    )
    try:
        send_verification_email(user, raw_token)
        user.verification_email_sent_at = timezone.now()
        user.save(update_fields=["verification_email_sent_at"])
        _log_activity(request, user.id, "email_verification_sent", {"email": user.email})
        return True
    except Exception:
        return False


class RegisterView(APIView):
    permission_classes = []
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return fail("Thiếu hoặc sai định dạng trường bắt buộc", 400, "validation_error", serializer.errors)

        payload = serializer.validated_data
        if User.objects.filter(username=payload["username"]).exists():
            return fail("Tên đăng nhập đã tồn tại", 409, "username_exists")

        if User.objects.filter(email=payload["email"]).exists():
            return fail("Email đã tồn tại", 409, "email_exists")

        with transaction.atomic():
            user = User(
                username=payload["username"],
                email=payload["email"],
                full_name=payload.get("fullName") or None,
                role="user",
                is_active=True,
                created_at=timezone.now(),
                email_verified_at=None,
                verification_email_sent_at=None,
            )
            user.set_password(payload["password"])
            try:
                user.save()
            except IntegrityError:
                return fail("Tên đăng nhập hoặc email đã tồn tại", 409, "conflict")

        email_sent = _send_verification_for_user(user, request)
        _log_activity(request, user.id, "register_requested", {"username": user.username, "email_sent": email_sent})

        message = "Đăng ký thành công. Vui lòng kiểm tra email để xác thực tài khoản."
        if not email_sent:
            message = "Đăng ký thành công nhưng chưa thể gửi email xác thực. Bạn có thể thử gửi lại email xác thực."

        return ok(
            {
                "message": message,
                "requiresEmailVerification": True,
                "emailSent": email_sent,
                "user": _user_payload(user),
            },
            201,
        )


class LoginView(APIView):
    permission_classes = []
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return fail("Tên đăng nhập và mật khẩu là bắt buộc", 400, "validation_error", serializer.errors)

        username = serializer.validated_data["username"]
        password = serializer.validated_data["password"]
        user = User.objects.filter(username=username, is_active=True).first()
        if not user or not user.check_password(password):
            return fail("Tên đăng nhập hoặc mật khẩu không đúng", 401, "invalid_credentials")

        if not user.email_verified_at:
            return fail(
                "Email chưa được xác thực. Vui lòng kiểm tra hộp thư hoặc gửi lại email xác thực.",
                403,
                "email_not_verified",
                {
                    "requiresEmailVerification": True,
                    "username": user.username,
                    "email": user.email,
                },
            )

        user.last_login = timezone.now()
        user.last_login_ip = _client_ip(request)
        user.last_login_user_agent = request.headers.get("User-Agent")
        user.save(update_fields=["last_login", "last_login_ip", "last_login_user_agent"])
        token = generate_token(user)

        _log_activity(request, user.id, "login", {"username": user.username})

        return ok({"message": "Đăng nhập thành công", "token": token, "user": _user_payload(user)})


class ResendVerificationEmailView(APIView):
    permission_classes = []
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        if not serializer.is_valid():
            return fail("Thiếu email hoặc tên đăng nhập hợp lệ", 400, "validation_error", serializer.errors)

        payload = serializer.validated_data
        user = None
        if payload.get("email"):
            user = User.objects.filter(email=payload["email"], is_active=True).first()
        elif payload.get("username"):
            user = User.objects.filter(username=payload["username"], is_active=True).first()

        if not user:
            return ok({"message": "Nếu tài khoản tồn tại, email xác thực đã được gửi lại."})

        if user.email_verified_at:
            return ok({"message": "Tài khoản này đã xác thực email trước đó.", "alreadyVerified": True})

        email_sent = _send_verification_for_user(user, request)
        if not email_sent:
            return fail("Chưa thể gửi lại email xác thực. Vui lòng thử lại sau.", 503, "email_delivery_failed")

        return ok({"message": "Email xác thực đã được gửi lại thành công.", "emailSent": True})


class VerifyEmailView(APIView):
    permission_classes = []
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        if not serializer.is_valid():
            return fail("Token xác thực không hợp lệ", 400, "validation_error", serializer.errors)

        token = consume_email_token(serializer.validated_data["token"], VERIFY_EMAIL)
        if not token:
            return fail("Liên kết xác thực không hợp lệ hoặc đã hết hạn", 400, "invalid_or_expired_token")

        user = token.user
        if not user.email_verified_at:
            user.email_verified_at = timezone.now()
            user.save(update_fields=["email_verified_at"])

        _log_activity(request, user.id, "email_verified", {"email": user.email})
        return ok({"message": "Xác thực email thành công. Bạn có thể đăng nhập ngay bây giờ."})


class ForgotPasswordView(APIView):
    permission_classes = []
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return fail("Email không hợp lệ", 400, "validation_error", serializer.errors)

        email = serializer.validated_data["email"]
        user = User.objects.filter(email=email, is_active=True).first()
        if user:
            raw_token = issue_email_token(
                user,
                RESET_PASSWORD,
                created_ip=_client_ip(request),
                created_user_agent=request.headers.get("User-Agent"),
                expires_in_minutes=RESET_PASSWORD_MINUTES,
            )
            try:
                send_reset_password_email(user, raw_token)
                _log_activity(request, user.id, "forgot_password_requested", {"email": user.email})
            except Exception:
                pass

        return ok({"message": "Nếu email tồn tại, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu."})


class ResetPasswordView(APIView):
    permission_classes = []
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return fail("Thiếu token hoặc mật khẩu mới không hợp lệ", 400, "validation_error", serializer.errors)

        token = consume_email_token(serializer.validated_data["token"], RESET_PASSWORD)
        if not token:
            return fail("Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn", 400, "invalid_or_expired_token")

        user = token.user
        user.set_password(serializer.validated_data["new_password"])
        user.password_changed_at = timezone.now()
        user.save(update_fields=["password_hash", "password_changed_at"])

        password_change_notified = True
        try:
            send_password_changed_email(user)
        except Exception:
            password_change_notified = False

        _log_activity(request, user.id, "password_reset_completed", {"email": user.email})
        return ok(
            {
                "message": "Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.",
                "passwordChangeNotified": password_change_notified,
            }
        )


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        _log_activity(request, request.user.id, "logout", {"username": request.user.username})
        return ok({"message": "Đăng xuất thành công"})


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return ok(
            {
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "fullName": user.full_name,
                    "role": user.role,
                    "createdAt": user.created_at,
                    "lastLogin": user.last_login,
                    "emailVerifiedAt": user.email_verified_at,
                }
            }
        )
