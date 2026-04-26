from django.urls import path

from .views import (
    AdminActivityView,
    AdminGeeStatusView,
    AdminGeeSyncView,
    AdminLocationDetailView,
    AdminLocationsView,
    AdminManualEntriesView,
    AdminManualEntryDetailView,
    AdminOverviewView,
    AdminStationDetailView,
    AdminStationsView,
    AdminUserDetailView,
    AdminUsersView,
)


urlpatterns = [
    path("overview", AdminOverviewView.as_view()),
    path("users", AdminUsersView.as_view()),
    path("users/<int:user_id>", AdminUserDetailView.as_view()),
    path("stations", AdminStationsView.as_view()),
    path("stations/<int:station_id>", AdminStationDetailView.as_view()),
    path("manual-entries", AdminManualEntriesView.as_view()),
    path("manual-entries/<str:data_type>/<int:record_id>", AdminManualEntryDetailView.as_view()),
    path("locations", AdminLocationsView.as_view()),
    path("locations/<int:location_id>", AdminLocationDetailView.as_view()),
    path("gee/status", AdminGeeStatusView.as_view()),
    path("gee/sync", AdminGeeSyncView.as_view()),
    path("activity", AdminActivityView.as_view()),
]
