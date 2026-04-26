from __future__ import annotations

import os
from email.utils import parseaddr
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-only-change-me")
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = [host.strip() for host in os.getenv("ALLOWED_HOSTS", "*").split(",") if host.strip()]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "apps.accounts",
    "apps.admin_portal",
    "apps.activity",
    "apps.climate",
    "apps.gee",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [],
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "HOST": os.getenv("DB_HOST", "localhost"),
        "PORT": os.getenv("DB_PORT", "5432"),
        "USER": os.getenv("DB_USER", "postgres"),
        "PASSWORD": os.getenv("DB_PASS", ""),
        "NAME": os.getenv("DB_NAME", "web_gis"),
    }
}

LANGUAGE_CODE = "vi"
TIME_ZONE = "Asia/Ho_Chi_Minh"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOW_ALL_ORIGINS = os.getenv("CORS_ALLOW_ALL", "true").lower() == "true"
CORS_ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
CORS_ALLOW_CREDENTIALS = True

if not DEBUG and SECRET_KEY == "dev-only-change-me":
    raise RuntimeError("DJANGO_SECRET_KEY must be set in production.")
if not DEBUG and ALLOWED_HOSTS == ["*"]:
    raise RuntimeError("ALLOWED_HOSTS cannot be '*' in production.")
if not DEBUG and CORS_ALLOW_ALL_ORIGINS:
    raise RuntimeError("CORS_ALLOW_ALL must be false in production.")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.common.auth.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_EXPIRES_DAYS = int(os.getenv("JWT_EXPIRES_DAYS", "7"))

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "true").lower() == "true"
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Do An GIS <no-reply@example.com>")
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://127.0.0.1:5173")
MAILTRAP_API_TOKEN = os.getenv("MAILTRAP_API_TOKEN", "")
MAILTRAP_API_URL = os.getenv("MAILTRAP_API_URL", "https://send.api.mailtrap.io/api/send")

DEFAULT_FROM_NAME, DEFAULT_FROM_ADDRESS = parseaddr(DEFAULT_FROM_EMAIL)
if not DEFAULT_FROM_ADDRESS:
    DEFAULT_FROM_ADDRESS = DEFAULT_FROM_EMAIL
if not DEFAULT_FROM_NAME:
    DEFAULT_FROM_NAME = "Do An GIS"

PYTHON_GEE_API_URL = os.getenv("PYTHON_GEE_API_URL", "http://127.0.0.1:3001")
GEOCODER_SEARCH_URL = os.getenv("GEOCODER_SEARCH_URL", "https://nominatim.openstreetmap.org/search")
GEOCODER_REVERSE_URL = os.getenv("GEOCODER_REVERSE_URL", "https://nominatim.openstreetmap.org/reverse")
ROUTING_API_URL = os.getenv("ROUTING_API_URL", "https://router.project-osrm.org/route/v1")
MAP_PROXY_USER_AGENT = os.getenv("MAP_PROXY_USER_AGENT", "web-gis-climate/1.0")

if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is required. Set it in backend/.env")
