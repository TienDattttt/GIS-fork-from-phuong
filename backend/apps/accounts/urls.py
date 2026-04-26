from django.urls import path

from .views import (
    CurrentUserView,
    ForgotPasswordView,
    LoginView,
    LogoutView,
    RegisterView,
    ResendVerificationEmailView,
    ResetPasswordView,
    VerifyEmailView,
)


urlpatterns = [
    path("register", RegisterView.as_view()),
    path("login", LoginView.as_view()),
    path("verify-email", VerifyEmailView.as_view()),
    path("verify-email/resend", ResendVerificationEmailView.as_view()),
    path("forgot-password", ForgotPasswordView.as_view()),
    path("reset-password", ResetPasswordView.as_view()),
    path("logout", LogoutView.as_view()),
    path("me", CurrentUserView.as_view()),
]
