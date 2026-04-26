from __future__ import annotations

from html import escape
from urllib.parse import quote

import requests
from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from .models import User


def _join_url(path: str) -> str:
    base_url = settings.FRONTEND_BASE_URL.rstrip("/")
    return f"{base_url}{path}"


def _send_via_mailtrap_api(subject: str, body_text: str, body_html: str, recipient: str) -> None:
    response = requests.post(
        settings.MAILTRAP_API_URL,
        headers={
            "Authorization": f"Bearer {settings.MAILTRAP_API_TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "from": {
                "email": settings.DEFAULT_FROM_ADDRESS,
                "name": settings.DEFAULT_FROM_NAME,
            },
            "to": [{"email": recipient}],
            "subject": subject,
            "text": body_text,
            "html": body_html,
            "category": "auth",
        },
        timeout=20,
    )
    response.raise_for_status()


def _send_via_smtp(subject: str, body_text: str, body_html: str, recipient: str) -> None:
    message = EmailMultiAlternatives(
        subject=subject,
        body=body_text,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient],
    )
    message.attach_alternative(body_html, "text/html")
    message.send(fail_silently=False)


def _send_account_email(subject: str, body_text: str, body_html: str, recipient: str) -> None:
    if settings.MAILTRAP_API_TOKEN:
        _send_via_mailtrap_api(subject, body_text, body_html, recipient)
        return

    _send_via_smtp(subject, body_text, body_html, recipient)


def send_verification_email(user: User, raw_token: str) -> None:
    verify_url = _join_url(f"/verify-email?token={quote(raw_token)}&email={quote(user.email)}")
    name = escape(user.full_name or user.username)
    subject = "Xác thực email tài khoản Do An GIS"
    body_text = (
        f"Xin chào {user.full_name or user.username},\n\n"
        "Cảm ơn bạn đã đăng ký tài khoản Do An GIS.\n"
        f"Vui lòng xác thực email tại liên kết sau:\n{verify_url}\n\n"
        "Liên kết có hiệu lực trong thời gian giới hạn. Nếu bạn không thực hiện đăng ký, hãy bỏ qua email này."
    )
    body_html = f"""
    <div style="font-family: Arial, sans-serif; color: #0f2132; line-height: 1.6;">
      <h2 style="margin-bottom: 12px;">Xác thực email tài khoản</h2>
      <p>Xin chào <strong>{name}</strong>,</p>
      <p>Cảm ơn bạn đã đăng ký tài khoản Do An GIS. Vui lòng xác thực email để kích hoạt tài khoản.</p>
      <p>
        <a href="{verify_url}" style="display: inline-block; padding: 12px 18px; border-radius: 10px; background: #0077b6; color: #ffffff; text-decoration: none; font-weight: 700;">
          Xác thực email
        </a>
      </p>
      <p>Nếu nút không hoạt động, bạn có thể sao chép liên kết sau:</p>
      <p><a href="{verify_url}">{verify_url}</a></p>
      <p>Nếu bạn không thực hiện đăng ký, hãy bỏ qua email này.</p>
    </div>
    """
    _send_account_email(subject, body_text, body_html, user.email)


def send_reset_password_email(user: User, raw_token: str) -> None:
    reset_url = _join_url(f"/reset-password?token={quote(raw_token)}")
    name = escape(user.full_name or user.username)
    subject = "Yêu cầu đặt lại mật khẩu Do An GIS"
    body_text = (
        f"Xin chào {user.full_name or user.username},\n\n"
        "Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.\n"
        f"Vui lòng tiếp tục tại liên kết sau:\n{reset_url}\n\n"
        "Nếu bạn không yêu cầu thay đổi mật khẩu, hãy bỏ qua email này."
    )
    body_html = f"""
    <div style="font-family: Arial, sans-serif; color: #0f2132; line-height: 1.6;">
      <h2 style="margin-bottom: 12px;">Đặt lại mật khẩu</h2>
      <p>Xin chào <strong>{name}</strong>,</p>
      <p>Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản Do An GIS của bạn.</p>
      <p>
        <a href="{reset_url}" style="display: inline-block; padding: 12px 18px; border-radius: 10px; background: #0077b6; color: #ffffff; text-decoration: none; font-weight: 700;">
          Đặt lại mật khẩu
        </a>
      </p>
      <p>Nếu nút không hoạt động, bạn có thể sao chép liên kết sau:</p>
      <p><a href="{reset_url}">{reset_url}</a></p>
      <p>Nếu bạn không yêu cầu thay đổi mật khẩu, hãy bỏ qua email này.</p>
    </div>
    """
    _send_account_email(subject, body_text, body_html, user.email)


def send_password_changed_email(user: User) -> None:
    name = escape(user.full_name or user.username)
    subject = "Mật khẩu tài khoản Do An GIS vừa được thay đổi"
    body_text = (
        f"Xin chào {user.full_name or user.username},\n\n"
        "Mật khẩu tài khoản Do An GIS của bạn vừa được thay đổi thành công.\n"
        "Nếu đây không phải là bạn, hãy liên hệ quản trị viên ngay lập tức."
    )
    body_html = f"""
    <div style="font-family: Arial, sans-serif; color: #0f2132; line-height: 1.6;">
      <h2 style="margin-bottom: 12px;">Mật khẩu đã được thay đổi</h2>
      <p>Xin chào <strong>{name}</strong>,</p>
      <p>Mật khẩu tài khoản Do An GIS của bạn vừa được thay đổi thành công.</p>
      <p>Nếu đây không phải là bạn, hãy liên hệ quản trị viên ngay để được hỗ trợ bảo mật tài khoản.</p>
    </div>
    """
    _send_account_email(subject, body_text, body_html, user.email)
