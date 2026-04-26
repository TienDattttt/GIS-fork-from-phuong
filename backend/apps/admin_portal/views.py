from __future__ import annotations

from datetime import date, timedelta

from django.db import IntegrityError
from django.db.models import Count, Q
from django.utils import timezone
from requests import RequestException
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.activity.models import ActivityLog
from apps.climate.models import (
    AdminBoundary,
    AnalysisAreaHistory,
    Location,
    MonitoringStation,
    NdviData,
    RainfallData,
    SoilMoistureData,
    TemperatureData,
    TvdiData,
)
from apps.climate.services import parse_iso_date
from apps.common.permissions import IsAdminRole
from apps.common.responses import fail, ok
from apps.gee.services import check_status, fetch_data, validate_fetch_payload


MANUAL_DATA_TYPE_CONFIG = {
    "rainfall": {
        "model": RainfallData,
        "field": "rainfall_mm",
        "set_value": lambda row, value: setattr(row, "rainfall_mm", value),
        "get_value": lambda row: row.rainfall_mm,
    },
    "temperature": {
        "model": TemperatureData,
        "field": "temp_mean",
        "set_value": lambda row, value: (
            setattr(row, "temp_mean", value),
            setattr(row, "temp_min", value),
            setattr(row, "temp_max", value),
        ),
        "get_value": lambda row: row.temp_mean,
    },
    "soil_moisture": {
        "model": SoilMoistureData,
        "field": "sm_surface",
        "set_value": lambda row, value: (
            setattr(row, "sm_surface", value),
            setattr(row, "sm_rootzone", value),
            setattr(row, "sm_profile", value),
        ),
        "get_value": lambda row: row.sm_surface,
    },
    "ndvi": {
        "model": NdviData,
        "field": "ndvi_mean",
        "set_value": lambda row, value: (
            setattr(row, "ndvi_mean", value),
            setattr(row, "ndvi_min", value),
            setattr(row, "ndvi_max", value),
            setattr(row, "ndvi_stddev", 0.0),
            setattr(row, "vegetation_area_pct", max(0.0, min(100.0, value * 100))),
        ),
        "get_value": lambda row: row.ndvi_mean,
    },
}


def _admin_fail(message: str, status_code=400, code="validation_error", details=None):
    return fail(message, status_code, code, details)


def _parse_int(value, name: str, minimum: int | None = None, maximum: int | None = None, default: int | None = None):
    if value in (None, ""):
        if default is not None:
            return default
        raise ValueError(f"Missing required parameter: {name}")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {name}. Must be an integer.") from exc
    if minimum is not None and parsed < minimum:
        raise ValueError(f"Invalid {name}. Must be >= {minimum}.")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"Invalid {name}. Must be <= {maximum}.")
    return parsed


def _to_float(value, precision: int = 4):
    if value is None:
        return None
    try:
        return round(float(value), precision)
    except (TypeError, ValueError):
        return None


def _extract_geometry_center(geometry):
    if not isinstance(geometry, dict):
        return None, None
    payload = geometry.get("geometry") if geometry.get("type") == "Feature" else geometry
    coordinates = payload.get("coordinates") if isinstance(payload, dict) else None
    if not coordinates:
        return None, None

    points = []

    def collect(value):
        if not isinstance(value, list):
            return
        if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
            points.append((float(value[1]), float(value[0])))
            return
        for item in value:
            collect(item)

    collect(coordinates)
    if not points:
        return None, None

    lat = sum(point[0] for point in points) / len(points)
    lng = sum(point[1] for point in points) / len(points)
    return round(lat, 6), round(lng, 6)


def _resolve_location_center(location):
    boundary = (
        AdminBoundary.objects.filter(location_id=location.id)
        .exclude(centroid_lat__isnull=True)
        .exclude(centroid_lng__isnull=True)
        .order_by("admin_level")
        .values("centroid_lat", "centroid_lng")
        .first()
    )
    if boundary:
        return _to_float(boundary["centroid_lat"], 6), _to_float(boundary["centroid_lng"], 6)
    return _extract_geometry_center(location.geometry)


def _serialize_location(location):
    lat, lng = _resolve_location_center(location)
    return {
        "id": location.id,
        "name": location.name,
        "province": location.province,
        "geometry": location.geometry,
        "centroid_lat": lat,
        "centroid_lng": lng,
        "has_geometry": bool(location.geometry),
    }


def _serialize_user(user):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at,
        "last_login": user.last_login,
        "email_verified_at": user.email_verified_at,
        "password_changed_at": user.password_changed_at,
    }


def _serialize_station(station):
    return {
        "id": station.id,
        "name": station.name,
        "station_type": station.station_type,
        "lat": _to_float(station.lat, 6),
        "lon": _to_float(station.lon, 6),
        "rainfall_mm": _to_float(station.rainfall_mm, 2),
        "source_description": station.source_description,
        "address": station.address,
        "created_at": station.created_at,
    }


def _serialize_manual_entry(data_type: str, row):
    station = getattr(row, "source_station", None)
    return {
        "id": row.id,
        "data_type": data_type,
        "location_id": row.location_id,
        "location_name": getattr(row.location, "name", None),
        "location_province": getattr(row.location, "province", None),
        "date": row.date,
        "value": _to_float(MANUAL_DATA_TYPE_CONFIG[data_type]["get_value"](row), 4),
        "notes": getattr(row, "notes", None),
        "source_station_id": getattr(row, "source_station_id", None),
        "source_station_name": getattr(station, "name", None),
        "source": row.source,
    }


def _validate_station_type(value: str) -> str:
    station_type = (value or "").strip().lower()
    if station_type not in {"water", "air", "rainfall"}:
        raise ValueError("Invalid station_type. Allowed values: water, air, rainfall.")
    return station_type


def _build_manual_location_name(lat: float, lng: float) -> str:
    return f"Diem nhap tay {round(lat, 4)}, {round(lng, 4)}"


def _get_or_create_manual_location(lat: float, lng: float):
    lat = round(float(lat), 6)
    lng = round(float(lng), 6)
    for location in Location.objects.filter(province="Vung nhap tay"):
        center_lat, center_lng = _extract_geometry_center(location.geometry)
        if center_lat is None or center_lng is None:
            continue
        if abs(center_lat - lat) < 0.000001 and abs(center_lng - lng) < 0.000001:
            return location

    return Location.objects.create(
        name=_build_manual_location_name(lat, lng),
        province="Vung nhap tay",
        geometry={
            "type": "Feature",
            "properties": {"source": "manual-entry"},
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
        },
    )


def _resolve_manual_location(data):
    location_id = data.get("location_id")
    lat = data.get("lat")
    lon = data.get("lon")

    if location_id not in (None, ""):
        location = Location.objects.filter(id=int(location_id)).first()
        if not location:
            raise ValueError("Location not found.")
        return location

    if lat in (None, "") or lon in (None, ""):
        raise ValueError("Provide either location_id or lat/lon.")

    return _get_or_create_manual_location(float(lat), float(lon))


def _log_admin_action(request, activity_type: str, details: dict | None = None):
    try:
        ActivityLog.create(
            user_id=request.user.id,
            activity_type=activity_type,
            page="admin",
            details=details or {},
            ip_address=request.META.get("REMOTE_ADDR"),
            user_agent=request.headers.get("User-Agent"),
        )
    except Exception:
        pass


class AdminBaseView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]


class AdminOverviewView(AdminBaseView):
    def get(self, request):
        gee_status = check_status()
        last_week = timezone.now() - timedelta(days=7)
        recent_activity = ActivityLog.objects.filter(created_at__gte=last_week).count()
        custom_areas = AnalysisAreaHistory.objects.count()

        return ok(
            {
                "stats": {
                    "users_total": User.objects.count(),
                    "users_active": User.objects.filter(is_active=True).count(),
                    "users_verified": User.objects.exclude(email_verified_at__isnull=True).count(),
                    "stations_total": MonitoringStation.objects.count(),
                    "locations_total": Location.objects.count(),
                    "manual_entries_total": (
                        RainfallData.objects.filter(source="manual").count()
                        + TemperatureData.objects.filter(source="manual").count()
                        + SoilMoistureData.objects.filter(source="manual").count()
                        + NdviData.objects.filter(source="manual").count()
                    ),
                    "custom_areas_total": custom_areas,
                    "recent_activity_7d": recent_activity,
                },
                "climate_records": {
                    "rainfall": RainfallData.objects.count(),
                    "temperature": TemperatureData.objects.count(),
                    "soil_moisture": SoilMoistureData.objects.count(),
                    "ndvi": NdviData.objects.count(),
                    "tvdi": TvdiData.objects.count(),
                },
                "gee_status": gee_status,
                "recent_users": [_serialize_user(user) for user in User.objects.order_by("-created_at")[:5]],
            }
        )


class AdminUsersView(AdminBaseView):
    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        role = (request.query_params.get("role") or "").strip()
        status = (request.query_params.get("status") or "").strip()

        queryset = User.objects.all().order_by("-created_at")
        if query:
            queryset = queryset.filter(Q(username__icontains=query) | Q(email__icontains=query) | Q(full_name__icontains=query))
        if role:
            queryset = queryset.filter(role=role)
        if status == "active":
            queryset = queryset.filter(is_active=True)
        elif status == "inactive":
            queryset = queryset.filter(is_active=False)

        limit = min(_parse_int(request.query_params.get("limit"), "limit", minimum=1, maximum=500, default=100), 500)
        return ok([_serialize_user(user) for user in queryset[:limit]])


class AdminUserDetailView(AdminBaseView):
    def put(self, request, user_id: int):
        user = User.objects.filter(id=user_id).first()
        if not user:
            return _admin_fail("User not found.", 404, "not_found")

        data = request.data or {}
        next_role = data.get("role", user.role)
        next_active = data.get("is_active", user.is_active)
        full_name = data.get("full_name", user.full_name)

        if next_role not in {"user", "admin"}:
            return _admin_fail("Invalid role. Allowed values: user, admin.")
        if not isinstance(next_active, bool):
            return _admin_fail("is_active must be a boolean.")
        if request.user.id == user.id and not next_active:
            return _admin_fail("Bạn không thể tự khóa chính tài khoản admin đang đăng nhập.", 400, "self_lock_not_allowed")

        user.role = next_role
        user.is_active = next_active
        user.full_name = full_name
        user.save(update_fields=["role", "is_active", "full_name"])
        _log_admin_action(request, "admin_update_user", {"target_user_id": user.id, "role": user.role, "is_active": user.is_active})
        return ok(_serialize_user(user))


class AdminStationsView(AdminBaseView):
    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        station_type = (request.query_params.get("station_type") or "").strip()
        queryset = MonitoringStation.objects.all().order_by("name", "id")
        if query:
            queryset = queryset.filter(Q(name__icontains=query) | Q(address__icontains=query) | Q(source_description__icontains=query))
        if station_type:
            try:
                queryset = queryset.filter(station_type=_validate_station_type(station_type))
            except ValueError as exc:
                return _admin_fail(str(exc))
        return ok([_serialize_station(station) for station in queryset[:300]])

    def post(self, request):
        data = request.data or {}
        name = (data.get("name") or "").strip()
        if not name:
            return _admin_fail("Missing required field: name")
        try:
            station = MonitoringStation.objects.create(
                name=name,
                station_type=_validate_station_type(data.get("station_type")),
                lat=float(data.get("lat")),
                lon=float(data.get("lon")),
                rainfall_mm=float(data.get("rainfall_mm")) if data.get("rainfall_mm") not in (None, "") else None,
                source_description=(data.get("source_description") or "").strip() or None,
                address=(data.get("address") or "").strip() or None,
                created_at=timezone.now(),
            )
        except ValueError as exc:
            return _admin_fail(str(exc))
        except (TypeError, OverflowError):
            return _admin_fail("Invalid lat/lon/rainfall_mm. Must be numeric.")

        _log_admin_action(request, "admin_create_station", {"station_id": station.id, "station_type": station.station_type})
        return ok(_serialize_station(station), 201)


class AdminStationDetailView(AdminBaseView):
    def put(self, request, station_id: int):
        station = MonitoringStation.objects.filter(id=station_id).first()
        if not station:
            return _admin_fail("Monitoring station not found.", 404, "not_found")

        data = request.data or {}
        name = (data.get("name") or station.name or "").strip()
        if not name:
            return _admin_fail("Missing required field: name")

        try:
            station.name = name
            station.station_type = _validate_station_type(data.get("station_type") or station.station_type)
            station.lat = float(data.get("lat", station.lat))
            station.lon = float(data.get("lon", station.lon))
            rainfall_value = data.get("rainfall_mm", station.rainfall_mm)
            station.rainfall_mm = float(rainfall_value) if rainfall_value not in (None, "") else None
        except ValueError as exc:
            return _admin_fail(str(exc))
        except (TypeError, OverflowError):
            return _admin_fail("Invalid lat/lon/rainfall_mm. Must be numeric.")

        station.source_description = (data.get("source_description") or station.source_description or "").strip() or None
        station.address = (data.get("address") or station.address or "").strip() or None
        station.save(update_fields=["name", "station_type", "lat", "lon", "rainfall_mm", "source_description", "address"])
        _log_admin_action(request, "admin_update_station", {"station_id": station.id})
        return ok(_serialize_station(station))

    def delete(self, request, station_id: int):
        station = MonitoringStation.objects.filter(id=station_id).first()
        if not station:
            return _admin_fail("Monitoring station not found.", 404, "not_found")
        try:
            station.delete()
        except IntegrityError:
            return _admin_fail("Cannot delete station because it is still referenced by existing manual records.", 409, "conflict")
        _log_admin_action(request, "admin_delete_station", {"station_id": station_id})
        return ok({"deleted": True, "id": station_id})


class AdminLocationsView(AdminBaseView):
    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        queryset = Location.objects.all().order_by("name")
        if query:
            queryset = queryset.filter(Q(name__icontains=query) | Q(province__icontains=query))
        return ok([_serialize_location(location) for location in queryset[:400]])

    def post(self, request):
        data = request.data or {}
        name = (data.get("name") or "").strip()
        province = (data.get("province") or "").strip()
        if not name or not province:
            return _admin_fail("Missing required fields: name, province")

        location = Location.objects.create(
            name=name,
            province=province,
            geometry=data.get("geometry") if isinstance(data.get("geometry"), dict) else None,
        )
        _log_admin_action(request, "admin_create_location", {"location_id": location.id})
        return ok(_serialize_location(location), 201)


class AdminLocationDetailView(AdminBaseView):
    def put(self, request, location_id: int):
        location = Location.objects.filter(id=location_id).first()
        if not location:
            return _admin_fail("Location not found.", 404, "not_found")

        data = request.data or {}
        name = (data.get("name") or location.name or "").strip()
        province = (data.get("province") or location.province or "").strip()
        if not name or not province:
            return _admin_fail("Missing required fields: name, province")

        location.name = name
        location.province = province
        if "geometry" in data:
            location.geometry = data.get("geometry") if isinstance(data.get("geometry"), dict) else None
        location.save(update_fields=["name", "province", "geometry"])
        _log_admin_action(request, "admin_update_location", {"location_id": location.id})
        return ok(_serialize_location(location))

    def delete(self, request, location_id: int):
        location = Location.objects.filter(id=location_id).first()
        if not location:
            return _admin_fail("Location not found.", 404, "not_found")
        try:
            location.delete()
        except IntegrityError:
            return _admin_fail("Cannot delete location because it is still referenced by climate data or history.", 409, "conflict")
        _log_admin_action(request, "admin_delete_location", {"location_id": location_id})
        return ok({"deleted": True, "id": location_id})


class AdminManualEntriesView(AdminBaseView):
    def get(self, request):
        data_type = (request.query_params.get("data_type") or "").strip()
        if data_type and data_type not in MANUAL_DATA_TYPE_CONFIG:
            return _admin_fail("Invalid data_type. Allowed values: rainfall, temperature, soil_moisture, ndvi")

        location_id = request.query_params.get("location_id")
        source_station_id = request.query_params.get("source_station_id")
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        limit = _parse_int(request.query_params.get("limit"), "limit", minimum=1, maximum=300, default=100)
        try:
            parsed_location_id = int(location_id) if location_id not in (None, "") else None
            parsed_source_station_id = int(source_station_id) if source_station_id not in (None, "") else None
            parsed_start = parse_iso_date(start, "start") if start else None
            parsed_end = parse_iso_date(end, "end") if end else None
        except ValueError as exc:
            return _admin_fail(str(exc))

        data_types = [data_type] if data_type else list(MANUAL_DATA_TYPE_CONFIG.keys())
        results = []
        for current_type in data_types:
            config = MANUAL_DATA_TYPE_CONFIG[current_type]
            queryset = config["model"].objects.select_related("location", "source_station").all()
            if parsed_location_id is not None:
                queryset = queryset.filter(location_id=parsed_location_id)
            if parsed_source_station_id is not None:
                queryset = queryset.filter(source_station_id=parsed_source_station_id)
            if parsed_start:
                queryset = queryset.filter(date__gte=parsed_start)
            if parsed_end:
                queryset = queryset.filter(date__lte=parsed_end)
            queryset = queryset.order_by("-date", "-id")[:limit]
            results.extend([_serialize_manual_entry(current_type, row) for row in queryset])

        results.sort(key=lambda row: (str(row["date"]), row["id"]), reverse=True)
        return ok(results[:limit])

    def post(self, request):
        data = request.data or {}
        data_type = (data.get("data_type") or "").strip()
        if data_type not in MANUAL_DATA_TYPE_CONFIG:
            return _admin_fail("Invalid data_type. Allowed values: rainfall, temperature, soil_moisture, ndvi")

        try:
            location = _resolve_manual_location(data)
            entry_date = parse_iso_date(data.get("date"), "date")
            value = float(data.get("value"))
        except ValueError as exc:
            return _admin_fail(str(exc))
        except (TypeError, OverflowError):
            return _admin_fail("Invalid numeric value in payload.")

        source_station = None
        source_station_id = data.get("source_station_id")
        if source_station_id not in (None, ""):
            source_station = MonitoringStation.objects.filter(id=int(source_station_id)).first()
            if not source_station:
                return _admin_fail("Source station not found.")

        config = MANUAL_DATA_TYPE_CONFIG[data_type]
        row, _ = config["model"].objects.get_or_create(location=location, date=entry_date)
        config["set_value"](row, value)
        row.notes = (data.get("notes") or "").strip() or None
        row.source_station = source_station
        row.source = "manual"
        update_fields = [config["field"], "notes", "source_station", "source"]
        if data_type == "temperature":
            update_fields = ["temp_mean", "temp_min", "temp_max", "notes", "source_station", "source"]
        elif data_type == "soil_moisture":
            update_fields = ["sm_surface", "sm_rootzone", "sm_profile", "notes", "source_station", "source"]
        elif data_type == "ndvi":
            update_fields = ["ndvi_mean", "ndvi_min", "ndvi_max", "ndvi_stddev", "vegetation_area_pct", "notes", "source_station", "source"]
        row.save(update_fields=update_fields)
        _log_admin_action(request, "admin_create_manual_entry", {"data_type": data_type, "record_id": row.id})
        row.refresh_from_db()
        return ok(_serialize_manual_entry(data_type, row), 201)


class AdminManualEntryDetailView(AdminBaseView):
    def put(self, request, data_type: str, record_id: int):
        if data_type not in MANUAL_DATA_TYPE_CONFIG:
            return _admin_fail("Invalid data_type. Allowed values: rainfall, temperature, soil_moisture, ndvi")
        config = MANUAL_DATA_TYPE_CONFIG[data_type]
        row = config["model"].objects.select_related("location", "source_station").filter(id=record_id).first()
        if not row:
            return _admin_fail("Manual entry not found.", 404, "not_found")

        data = request.data or {}
        try:
            if "location_id" in data or "lat" in data or "lon" in data:
                location = _resolve_manual_location(data)
                row.location = location
            if "date" in data:
                row.date = parse_iso_date(data.get("date"), "date")
            if "value" in data:
                config["set_value"](row, float(data.get("value")))
        except ValueError as exc:
            return _admin_fail(str(exc))
        except (TypeError, OverflowError):
            return _admin_fail("Invalid numeric value in payload.")

        if "notes" in data:
            row.notes = (data.get("notes") or "").strip() or None
        if "source_station_id" in data:
            source_station_id = data.get("source_station_id")
            if source_station_id in (None, "", 0):
                row.source_station = None
            else:
                source_station = MonitoringStation.objects.filter(id=int(source_station_id)).first()
                if not source_station:
                    return _admin_fail("Source station not found.")
                row.source_station = source_station
        row.source = "manual"
        row.save()
        _log_admin_action(request, "admin_update_manual_entry", {"data_type": data_type, "record_id": row.id})
        row.refresh_from_db()
        return ok(_serialize_manual_entry(data_type, row))

    def delete(self, request, data_type: str, record_id: int):
        if data_type not in MANUAL_DATA_TYPE_CONFIG:
            return _admin_fail("Invalid data_type. Allowed values: rainfall, temperature, soil_moisture, ndvi")
        config = MANUAL_DATA_TYPE_CONFIG[data_type]
        row = config["model"].objects.filter(id=record_id).first()
        if not row:
            return _admin_fail("Manual entry not found.", 404, "not_found")
        row.delete()
        _log_admin_action(request, "admin_delete_manual_entry", {"data_type": data_type, "record_id": record_id})
        return ok({"deleted": True, "id": record_id, "data_type": data_type})


class AdminGeeStatusView(AdminBaseView):
    def get(self, request):
        return ok(check_status())


class AdminGeeSyncView(AdminBaseView):
    def post(self, request):
        payload = dict(request.data or {})
        location_id = payload.get("location_id")
        if location_id and not payload.get("province"):
            province = Location.objects.filter(id=location_id).values_list("province", flat=True).first()
            if province:
                payload["province"] = province

        valid, error_payload = validate_fetch_payload(payload)
        if not valid:
            return _admin_fail(error_payload["error"], 400, "validation_error", error_payload)

        status = check_status()
        if status.get("status") != "online":
            return _admin_fail("GEE service is offline.", 503, "gee_service_offline", status)

        try:
            result = fetch_data(payload)
        except RequestException as exc:
            return _admin_fail("Failed to synchronize data from GEE.", 502, "gee_sync_failed", {"message": str(exc)})
        _log_admin_action(
            request,
            "admin_gee_sync",
            {
                "province": payload.get("province"),
                "location_id": payload.get("location_id"),
                "data_types": payload.get("data_types", []),
                "start_date": payload.get("start_date"),
                "end_date": payload.get("end_date"),
            },
        )
        return ok(result)


class AdminActivityView(AdminBaseView):
    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        activity_type = (request.query_params.get("activity_type") or "").strip()
        user_id = request.query_params.get("user_id")
        limit = _parse_int(request.query_params.get("limit"), "limit", minimum=1, maximum=500, default=100)
        try:
            parsed_user_id = int(user_id) if user_id not in (None, "") else None
        except ValueError:
            return _admin_fail("Invalid user_id. Must be an integer.")

        queryset = ActivityLog.objects.select_related("user").all().order_by("-created_at")
        if query:
            queryset = queryset.filter(Q(page__icontains=query) | Q(activity_type__icontains=query) | Q(user__username__icontains=query))
        if activity_type:
            queryset = queryset.filter(activity_type=activity_type)
        if parsed_user_id is not None:
            queryset = queryset.filter(user_id=parsed_user_id)

        payload = [
            {
                "id": row.id,
                "user_id": row.user_id,
                "username": getattr(row.user, "username", None),
                "activity_type": row.activity_type,
                "page": row.page,
                "details": row.details,
                "ip_address": row.ip_address,
                "created_at": row.created_at,
            }
            for row in queryset[:limit]
        ]
        return ok(payload)
