from django.http import JsonResponse
from django.urls import include, path


def healthcheck(request):
    return JsonResponse(
        {
            "message": "Web GIS Climate API",
            "version": "3.0.0-django",
            "endpoints": {
                "auth": {
                    "register": "POST /api/auth/register",
                    "login": "POST /api/auth/login",
                    "logout": "POST /api/auth/logout",
                    "me": "GET /api/auth/me",
                },
                "activity": {
                    "log": "POST /api/activity/log",
                    "history": "GET /api/activity/history",
                    "stats": "GET /api/activity/stats",
                },
                "boundaries": "/api/boundaries",
                "analysis_areas": "/api/analysis-areas/history",
                "standard_provinces": "/api/standard/provinces",
                "standard_wards": "/api/standard/wards",
                "locations": "/api/locations",
                "rainfall": "/api/rainfall",
                "temperature": "/api/temperature",
                "soil_moisture": "/api/soil-moisture",
                "ndvi": "/api/ndvi",
                "tvdi": "/api/tvdi",
                "dashboard": "/api/dashboard/overview",
                "admin": "/api/admin",
                "gee": "/api/gee",
            },
        }
    )


urlpatterns = [
    path("api/", healthcheck),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/admin/", include("apps.admin_portal.urls")),
    path("api/activity/", include("apps.activity.urls")),
    path("api/", include("apps.climate.urls")),
    path("api/gee/", include("apps.gee.urls")),
]
