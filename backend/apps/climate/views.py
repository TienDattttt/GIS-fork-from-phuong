from __future__ import annotations

from datetime import date
from django.db import IntegrityError, ProgrammingError
from django.db.models import Avg, Count, Max, Min, Q, Sum
from django.db.models.functions import ExtractMonth, ExtractYear
from requests import RequestException
from rest_framework.views import APIView

from apps.common.helpers import calculate_trend, fixed, to_float
from apps.common.responses import fail, ok
from apps.gee.services import check_status, fetch_data

from .geometry_analysis import (
    ndvi_geometry_response,
    rainfall_geometry_response,
    temperature_geometry_response,
    tvdi_geometry_response,
)
from .models import (
    AdminBoundary,
    Location,
    MonitoringStation,
    NdviData,
    Province,
    RainfallData,
    SoilMoistureData,
    TemperatureData,
    TvdiData,
    Ward,
)
from .rainfall_formula import calculate_idw_rainfall
from .services import dashboard_timeseries, ndvi_classification, parse_iso_date, tvdi_classification


def _parse_int_param(value, name: str, minimum: int | None = None, maximum: int | None = None) -> int:
    if value is None:
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


def _get_range_params(request):
    location_id_raw = request.query_params.get("location_id")
    start = request.query_params.get("start")
    end = request.query_params.get("end")
    location_id = _parse_int_param(location_id_raw, "location_id", minimum=1)
    start_date = parse_iso_date(start, "start")
    end_date = parse_iso_date(end, "end")
    if start_date > end_date:
        raise ValueError("Invalid date range: start must be before or equal to end.")
    return location_id, start_date, end_date


def _is_gee_source(request) -> bool:
    return request.query_params.get("source", "db").lower() == "gee"


def _resolve_province(location_id: int, province_query: str | None) -> str | None:
    if province_query:
        return province_query
    return Location.objects.filter(id=location_id).values_list("province", flat=True).first()


def _fetch_gee_records(
    location_id: int,
    start: date,
    end: date,
    data_type: str,
    province_query: str | None,
):
    province = _resolve_province(location_id, province_query)
    if not province:
        raise ValueError("Missing province. Provide `province` query param or create location with province.")

    status = check_status()
    if status.get("status") != "online" or not status.get("gee_initialized"):
        raise RuntimeError("GEE service is offline. Start backend/scripts/api_server.py and authenticate Earth Engine.")

    payload = {
        "province": province,
        "location_id": location_id,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "data_types": [data_type],
        "persist": False,
        "include_data": True,
    }
    result = fetch_data(payload)
    records = result.get("results", {}).get(data_type, {}).get("data", [])
    if not isinstance(records, list):
        records = []
    records.sort(key=lambda row: str(row.get("date", "")))
    return records


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
    return fixed(lat, 6), fixed(lng, 6)


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
        return fixed(boundary["centroid_lat"], 6), fixed(boundary["centroid_lng"], 6)
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


def _build_manual_location_name(lat: float, lng: float) -> str:
    return f"Diem nhap tay {fixed(lat, 4)}, {fixed(lng, 4)}"


def _get_or_create_manual_location(lat: float, lng: float):
    lat = fixed(lat, 6)
    lng = fixed(lng, 6)
    existing = None
    for location in Location.objects.filter(province="Vung nhap tay"):
        center_lat, center_lng = _extract_geometry_center(location.geometry)
        if center_lat is None or center_lng is None:
            continue
        if abs(center_lat - lat) < 0.000001 and abs(center_lng - lng) < 0.000001:
            existing = location
            break

    if existing:
        return existing

    return Location.objects.create(
        name=_build_manual_location_name(lat, lng),
        province="Vung nhap tay",
        geometry={
            "type": "Feature",
            "properties": {"source": "manual-entry"},
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
        },
    )


def _validate_station_type(value: str) -> str:
    station_type = (value or "").strip().lower()
    if station_type not in {"water", "air", "rainfall"}:
        raise ValueError("Invalid station_type. Allowed values: water, air, rainfall.")
    return station_type


def _serialize_station(station):
    return {
        "id": station.id,
        "name": station.name,
        "station_type": station.station_type,
        "lat": fixed(station.lat, 6),
        "lon": fixed(station.lon, 6),
        "rainfall_mm": fixed(station.rainfall_mm, 4) if station.rainfall_mm is not None else None,
        "source_description": station.source_description,
        "address": station.address,
        "created_at": station.created_at,
    }


def _monitoring_station_schema_response():
    return fail(
        "Bảng monitoring_stations chưa được khởi tạo. Hãy chạy bootstrap_monitoring_stations.sql trước.",
        503,
        "schema_missing",
    )


MANUAL_DATA_TYPE_CONFIG = {
    "rainfall": {
        "model": RainfallData,
        "field": "rainfall_mm",
        "serialize_value": lambda row: to_float(row.rainfall_mm),
        "apply_value": lambda row, value: setattr(row, "rainfall_mm", value),
        "date_field": "date",
        "source_station_field": "source_station_id",
    },
    "temperature": {
        "model": TemperatureData,
        "field": "temp_mean",
        "serialize_value": lambda row: to_float(row.temp_mean),
        "apply_value": lambda row, value: (
            setattr(row, "temp_mean", value),
            setattr(row, "temp_min", value),
            setattr(row, "temp_max", value),
        ),
        "date_field": "date",
        "source_station_field": "source_station_id",
    },
    "soil_moisture": {
        "model": SoilMoistureData,
        "field": "sm_surface",
        "serialize_value": lambda row: to_float(row.sm_surface),
        "apply_value": lambda row, value: (
            setattr(row, "sm_surface", value),
            setattr(row, "sm_rootzone", value),
            setattr(row, "sm_profile", value),
        ),
        "date_field": "date",
        "source_station_field": "source_station_id",
    },
    "ndvi": {
        "model": NdviData,
        "field": "ndvi_mean",
        "serialize_value": lambda row: to_float(row.ndvi_mean),
        "apply_value": lambda row, value: (
            setattr(row, "ndvi_mean", value),
            setattr(row, "ndvi_min", value),
            setattr(row, "ndvi_max", value),
            setattr(row, "ndvi_stddev", 0.0),
            setattr(row, "vegetation_area_pct", max(0.0, min(100.0, value * 100))),
        ),
        "date_field": "date",
        "source_station_field": "source_station_id",
    },
}


def _serialize_manual_entry(data_type: str, row):
    station_name = getattr(getattr(row, "source_station", None), "name", None)
    return {
        "id": row.id,
        "data_type": data_type,
        "location_id": row.location_id,
        "location_name": getattr(row.location, "name", None),
        "location_province": getattr(row.location, "province", None),
        "date": row.date,
        "value": MANUAL_DATA_TYPE_CONFIG[data_type]["serialize_value"](row),
        "notes": getattr(row, "notes", None),
        "source_station_id": getattr(row, "source_station_id", None),
        "source_station_name": station_name,
        "source": row.source,
    }


class LocationsView(APIView):
    permission_classes = []

    def get(self, request):
        rows = [_serialize_location(location) for location in Location.objects.order_by("name")]
        return ok(rows)


class LocationDetailView(APIView):
    permission_classes = []

    def get(self, request, location_id: int):
        location = Location.objects.filter(id=location_id).first()
        if not location:
            return fail("Location not found", 404, "not_found")
        return ok(_serialize_location(location))


class AdminBoundariesView(APIView):
    permission_classes = []

    def get(self, request):
        level_raw = request.query_params.get("level")
        include_geometry = request.query_params.get("include_geometry", "false").lower() == "true"
        parent_code = request.query_params.get("parent_code")
        province_name = request.query_params.get("province")

        try:
            level = _parse_int_param(level_raw, "level", minimum=1, maximum=3) if level_raw is not None else None
            limit = _parse_int_param(request.query_params.get("limit", 500), "limit", minimum=1, maximum=5000)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        queryset = AdminBoundary.objects.all()
        if level is not None:
            queryset = queryset.filter(admin_level=level)
        if parent_code:
            queryset = queryset.filter(parent_code=parent_code)
        if province_name:
            queryset = queryset.filter(province_name__iexact=province_name)

        fields = [
            "id",
            "boundary_code",
            "name",
            "normalized_name",
            "admin_level",
            "parent_code",
            "province_name",
            "location_id",
            "centroid_lat",
            "centroid_lng",
            "source",
            "effective_date",
            "metadata",
        ]
        if include_geometry:
            fields.append("geometry")

        rows = list(queryset.order_by("name").values(*fields)[:limit])
        for row in rows:
            row["has_geometry"] = bool(row.get("geometry")) if include_geometry else None
        return ok(rows)


class AdminBoundaryDetailView(APIView):
    permission_classes = []

    def get(self, request, admin_level: int, boundary_code: str):
        boundary = AdminBoundary.objects.filter(admin_level=admin_level, boundary_code=boundary_code).values().first()
        if not boundary:
            return fail("Boundary not found", 404, "not_found")
        return ok(boundary)


class StandardProvincesView(APIView):
    permission_classes = []

    def get(self, request):
        rows = list(
            Province.objects.select_related("administrative_unit")
            .values(
                "code",
                "name",
                "name_en",
                "full_name",
                "full_name_en",
                "code_name",
                "administrative_unit_id",
                "administrative_unit__short_name",
                "administrative_unit__short_name_en",
            )
            .order_by("code")
        )
        return ok(rows)


class StandardWardsView(APIView):
    permission_classes = []

    def get(self, request):
        province_code = request.query_params.get("province_code")
        limit_raw = request.query_params.get("limit", 500)
        try:
            limit = _parse_int_param(limit_raw, "limit", minimum=1, maximum=5000)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        queryset = Ward.objects.select_related("administrative_unit")
        if province_code:
            queryset = queryset.filter(province_code=province_code)

        rows = list(
            queryset.values(
                "code",
                "name",
                "name_en",
                "full_name",
                "full_name_en",
                "code_name",
                "province_code",
                "administrative_unit_id",
                "administrative_unit__short_name",
                "administrative_unit__short_name_en",
            )
            .order_by("code")[:limit]
        )
        return ok(rows)


class MonitoringStationsView(APIView):
    permission_classes = []

    def get(self, request):
        station_type = request.query_params.get("station_type")
        try:
            queryset = MonitoringStation.objects.all().order_by("name", "id")
            if station_type:
                try:
                    queryset = queryset.filter(station_type=_validate_station_type(station_type))
                except ValueError as exc:
                    return fail(str(exc), 400, "validation_error")
            return ok([_serialize_station(station) for station in queryset])
        except ProgrammingError:
            return _monitoring_station_schema_response()

    def post(self, request):
        data = request.data or {}
        name = (data.get("name") or "").strip()
        source_description = (data.get("source_description") or "").strip() or None
        address = (data.get("address") or "").strip() or None

        if not name:
            return fail("Missing required field: name", 400, "validation_error")

        try:
            station = MonitoringStation.objects.create(
                name=name,
                station_type=_validate_station_type(data.get("station_type")),
                lat=float(data.get("lat")),
                lon=float(data.get("lon")),
                rainfall_mm=float(data.get("rainfall_mm")) if data.get("rainfall_mm") not in (None, "") else None,
                source_description=source_description,
                address=address,
            )
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        except (TypeError, OverflowError):
            return fail("Invalid lat/lon/rainfall_mm. Must be numeric.", 400, "validation_error")
        except ProgrammingError:
            return _monitoring_station_schema_response()

        return ok(_serialize_station(station), 201)


class MonitoringStationDetailView(APIView):
    permission_classes = []

    def put(self, request, station_id: int):
        try:
            station = MonitoringStation.objects.filter(id=station_id).first()
        except ProgrammingError:
            return _monitoring_station_schema_response()
        if not station:
            return fail("Monitoring station not found", 404, "not_found")

        data = request.data or {}
        name = (data.get("name") or station.name or "").strip()
        if not name:
            return fail("Missing required field: name", 400, "validation_error")

        try:
            station.name = name
            station.station_type = _validate_station_type(data.get("station_type") or station.station_type)
            station.lat = float(data.get("lat", station.lat))
            station.lon = float(data.get("lon", station.lon))
            rainfall_value = data.get("rainfall_mm", station.rainfall_mm)
            station.rainfall_mm = float(rainfall_value) if rainfall_value not in (None, "") else None
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        except (TypeError, OverflowError):
            return fail("Invalid lat/lon/rainfall_mm. Must be numeric.", 400, "validation_error")
        except ProgrammingError:
            return _monitoring_station_schema_response()

        station.source_description = (data.get("source_description") or station.source_description or "").strip() or None
        station.address = (data.get("address") or station.address or "").strip() or None
        try:
            station.save(update_fields=["name", "station_type", "lat", "lon", "rainfall_mm", "source_description", "address"])
        except ProgrammingError:
            return _monitoring_station_schema_response()
        return ok(_serialize_station(station))

    def delete(self, request, station_id: int):
        try:
            station = MonitoringStation.objects.filter(id=station_id).first()
        except ProgrammingError:
            return _monitoring_station_schema_response()
        if not station:
            return fail("Monitoring station not found", 404, "not_found")
        try:
            station.delete()
        except IntegrityError:
            return fail(
                "Cannot delete station because it is still referenced by existing manual records.",
                409,
                "conflict",
            )
        except ProgrammingError:
            return _monitoring_station_schema_response()
        return ok({"deleted": True, "id": station_id})


class RainfallCalculationView(APIView):
    permission_classes = []

    def post(self, request):
        data = request.data or {}
        stations = data.get("stations")

        try:
            target_lat = float(data.get("target_lat"))
            target_lon = float(data.get("target_lon"))
        except (TypeError, ValueError):
            return fail("Invalid target_lat/target_lon. Must be numeric.", 400, "validation_error")

        if not isinstance(stations, list) or not stations:
            return fail("Stations must be a non-empty array.", 400, "validation_error")

        normalized = []
        try:
            for station in stations:
                normalized.append(
                    {
                        "lat": float(station.get("lat")),
                        "lon": float(station.get("lon")),
                        "rainfall_mm": float(station.get("rainfall_mm")),
                    }
                )
        except (AttributeError, TypeError, ValueError):
            return fail("Each station must include numeric lat, lon, rainfall_mm.", 400, "validation_error")

        try:
            result = calculate_idw_rainfall(target_lat, target_lon, normalized)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        payload = {
            "estimated_rainfall_mm": fixed(result["estimated_rainfall_mm"], 4),
            "formula_used": result["formula_used"],
            "computation_steps": [
                {
                    **step,
                    "Pi": fixed(step["Pi"], 4) if step.get("Pi") is not None else None,
                    "distance_km": fixed(step["distance_km"], 6) if step.get("distance_km") is not None else None,
                    "weight": fixed(step["weight"], 10) if step.get("weight") is not None else None,
                    "weighted_term": fixed(step["weighted_term"], 10) if step.get("weighted_term") is not None else None,
                    "contribution_mm": fixed(step["contribution_mm"], 6) if step.get("contribution_mm") is not None else None,
                }
                for step in result["computation_steps"]
            ],
        }
        return ok(payload)


class ManualEntryView(APIView):
    permission_classes = []

    def get(self, request):
        data_type = (request.query_params.get("data_type") or "").strip()
        config = MANUAL_DATA_TYPE_CONFIG.get(data_type)
        if not config:
            return fail(
                "Invalid data_type.",
                400,
                "validation_error",
                {"allowed": sorted(MANUAL_DATA_TYPE_CONFIG)},
            )

        queryset = (
            config["model"].objects.select_related("location", "source_station")
            .filter(source="manual")
            .order_by("-id")
        )
        location_id = request.query_params.get("location_id")
        if location_id:
            try:
                queryset = queryset.filter(location_id=_parse_int_param(location_id, "location_id", minimum=1))
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")

        rows = [_serialize_manual_entry(data_type, row) for row in queryset[:20]]
        return ok(rows)

    def post(self, request):
        data = request.data or {}
        data_type = (data.get("data_type") or "").strip()
        config = MANUAL_DATA_TYPE_CONFIG.get(data_type)
        if not config:
            return fail(
                "Invalid data_type.",
                400,
                "validation_error",
                {"allowed": sorted(MANUAL_DATA_TYPE_CONFIG)},
            )

        try:
            entry_date = parse_iso_date(data.get("date"), "date")
            value = float(data.get("value"))
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        except (TypeError, OverflowError):
            return fail("Invalid value. Must be numeric.", 400, "validation_error")

        location_id = data.get("location_id")
        if location_id:
            try:
                location = Location.objects.filter(id=_parse_int_param(location_id, "location_id", minimum=1)).first()
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            if not location:
                return fail("Location not found", 404, "not_found")
        else:
            try:
                lat = float(data.get("lat"))
                lon = float(data.get("lon"))
            except (TypeError, ValueError):
                return fail("Provide either location_id or numeric lat/lon.", 400, "validation_error")
            location = _get_or_create_manual_location(lat, lon)

        station = None
        source_station_id = data.get("source_station_id")
        if source_station_id:
            try:
                station = MonitoringStation.objects.filter(
                    id=_parse_int_param(source_station_id, "source_station_id", minimum=1)
                ).first()
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            if not station:
                return fail("Source station not found", 404, "not_found")

        row, _ = config["model"].objects.get_or_create(location_id=location.id, date=entry_date)
        config["apply_value"](row, value)
        row.source = "manual"
        row.notes = (data.get("notes") or "").strip() or None
        row.source_station_id = station.id if station else None
        row.save()
        row = config["model"].objects.select_related("location", "source_station").get(id=row.id)
        return ok(_serialize_manual_entry(data_type, row), 201)


class ManualEntryDetailView(APIView):
    permission_classes = []

    def delete(self, request, data_type: str, record_id: int):
        config = MANUAL_DATA_TYPE_CONFIG.get((data_type or "").strip())
        if not config:
            return fail(
                "Invalid data_type.",
                400,
                "validation_error",
                {"allowed": sorted(MANUAL_DATA_TYPE_CONFIG)},
            )

        deleted, _ = config["model"].objects.filter(id=record_id, source="manual").delete()
        if not deleted:
            return fail("Manual entry not found", 404, "not_found")
        return ok({"deleted": True, "id": record_id, "data_type": data_type})


class RainfallRangeView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id, start, end = _get_range_params(request)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=start,
                    end=end,
                    data_type="rainfall",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            data = [
                {
                    "date": str(row.get("date", ""))[:10],
                    "rainfall_mm": to_float(row.get("rainfall_mm")),
                    "source": row.get("source"),
                }
                for row in rows
            ]
        else:
            queryset = RainfallData.objects.filter(location_id=location_id, date__range=[start, end]).order_by("date")
            data = [
                {"date": row.date, "rainfall_mm": to_float(row.rainfall_mm), "source": row.source}
                for row in queryset
            ]

        total = sum(to_float(row["rainfall_mm"]) for row in data)
        avg = total / len(data) if data else 0
        max_value = max((to_float(row["rainfall_mm"]) for row in data), default=0)

        return ok(
            {
                "data": data,
                "statistics": {
                    "total": fixed(total, 2),
                    "average": fixed(avg, 2),
                    "max": fixed(max_value, 2),
                    "days": len(data),
                },
            }
        )

    def post(self, request):
        return rainfall_geometry_response(request)


class RainfallMonthlyView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            year = _parse_int_param(request.query_params.get("year"), "year", minimum=1900, maximum=2100)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=date(year, 1, 1),
                    end=date(year, 12, 31),
                    data_type="rainfall",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            grouped = {}
            for row in rows:
                try:
                    row_date = parse_iso_date(str(row.get("date", ""))[:10], "date")
                except ValueError:
                    continue
                month = row_date.month
                grouped.setdefault(month, [])
                grouped[month].append(to_float(row.get("rainfall_mm")))
            result = [
                {
                    "month": month,
                    "total": fixed(sum(values), 2),
                    "average": fixed(sum(values) / len(values) if values else 0, 2),
                    "max": fixed(max(values) if values else 0, 2),
                    "days": len(values),
                }
                for month, values in sorted(grouped.items())
            ]
        else:
            rows = (
                RainfallData.objects.filter(location_id=location_id, date__year=year)
                .annotate(month=ExtractMonth("date"))
                .values("month")
                .annotate(
                    total_rainfall=Sum("rainfall_mm"),
                    avg_rainfall=Avg("rainfall_mm"),
                    max_rainfall=Max("rainfall_mm"),
                    days_count=Count("id"),
                )
                .order_by("month")
            )
            result = [
                {
                    "month": int(row["month"]),
                    "total": fixed(row["total_rainfall"], 2),
                    "average": fixed(row["avg_rainfall"], 2),
                    "max": fixed(row["max_rainfall"], 2),
                    "days": int(row["days_count"]),
                }
                for row in rows
            ]
        return ok({"year": year, "monthly_data": result})


class RainfallYearlyView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            start_year = _parse_int_param(request.query_params.get("start_year"), "start_year", minimum=1900, maximum=2100)
            end_year = _parse_int_param(request.query_params.get("end_year"), "end_year", minimum=1900, maximum=2100)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        if start_year > end_year:
            return fail("Invalid year range: start_year must be <= end_year", 400, "validation_error")

        rows = (
            RainfallData.objects.filter(location_id=location_id, date__year__range=[start_year, end_year])
            .annotate(year=ExtractYear("date"))
            .values("year")
            .annotate(total_rainfall=Sum("rainfall_mm"), avg_rainfall=Avg("rainfall_mm"), max_rainfall=Max("rainfall_mm"))
            .order_by("year")
        )
        output = [
            {
                "year": int(row["year"]),
                "total": fixed(row["total_rainfall"], 2),
                "average": fixed(row["avg_rainfall"], 2),
                "max": fixed(row["max_rainfall"], 2),
            }
            for row in rows
        ]
        trend = calculate_trend([{"x": row["year"], "y": to_float(row["total"])} for row in output])
        return ok({"yearly_data": output, "trend": trend})


class RainfallComparePeriodsView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            start1 = parse_iso_date(request.query_params.get("start1"), "start1")
            end1 = parse_iso_date(request.query_params.get("end1"), "end1")
            start2 = parse_iso_date(request.query_params.get("start2"), "start2")
            end2 = parse_iso_date(request.query_params.get("end2"), "end2")
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        if start1 > end1 or start2 > end2:
            return fail("Invalid date range: start date must be before or equal to end date", 400, "validation_error")

        data1 = RainfallData.objects.filter(location_id=location_id, date__range=[start1, end1])
        data2 = RainfallData.objects.filter(location_id=location_id, date__range=[start2, end2])

        total1 = sum(to_float(row.rainfall_mm) for row in data1)
        total2 = sum(to_float(row.rainfall_mm) for row in data2)
        avg1 = total1 / data1.count() if data1.exists() else 0
        avg2 = total2 / data2.count() if data2.exists() else 0
        percentage_change = ((total1 - total2) / total2) * 100 if total2 else 0

        return ok(
            {
                "period_1": {"start": start1, "end": end1, "total": fixed(total1), "average": fixed(avg1), "days": data1.count()},
                "period_2": {"start": start2, "end": end2, "total": fixed(total2), "average": fixed(avg2), "days": data2.count()},
                "comparison": {"difference": fixed(total1 - total2), "percentage_change": fixed(percentage_change)},
            }
        )


class RainfallCompareLocationsView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location1 = _parse_int_param(request.query_params.get("location1"), "location1", minimum=1)
            location2 = _parse_int_param(request.query_params.get("location2"), "location2", minimum=1)
            start = parse_iso_date(request.query_params.get("start"), "start")
            end = parse_iso_date(request.query_params.get("end"), "end")
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        if start > end:
            return fail("Invalid date range: start must be before or equal to end", 400, "validation_error")

        data1 = RainfallData.objects.filter(location_id=location1, date__range=[start, end])
        data2 = RainfallData.objects.filter(location_id=location2, date__range=[start, end])

        total1 = sum(to_float(row.rainfall_mm) for row in data1)
        total2 = sum(to_float(row.rainfall_mm) for row in data2)

        return ok(
            {
                "location_1": {
                    "id": location1,
                    "total": fixed(total1),
                    "average": fixed(total1 / data1.count() if data1.exists() else 0),
                },
                "location_2": {
                    "id": location2,
                    "total": fixed(total2),
                    "average": fixed(total2 / data2.count() if data2.exists() else 0),
                },
                "difference": fixed(total1 - total2),
            }
        )


class TemperatureRangeView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id, start, end = _get_range_params(request)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=start,
                    end=end,
                    data_type="temperature",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            data = [
                {
                    "date": str(row.get("date", ""))[:10],
                    "temp_min": to_float(row.get("temp_min")),
                    "temp_max": to_float(row.get("temp_max")),
                    "temp_mean": to_float(row.get("temp_mean")),
                    "source": row.get("source"),
                }
                for row in rows
            ]
        else:
            queryset = TemperatureData.objects.filter(location_id=location_id, date__range=[start, end]).order_by("date")
            data = [
                {
                    "date": row.date,
                    "temp_min": to_float(row.temp_min),
                    "temp_max": to_float(row.temp_max),
                    "temp_mean": to_float(row.temp_mean),
                    "source": row.source,
                }
                for row in queryset
            ]
        average = sum(to_float(r["temp_mean"]) for r in data) / len(data) if data else 0
        min_value = min((to_float(r["temp_min"]) for r in data), default=0)
        max_value = max((to_float(r["temp_max"]) for r in data), default=0)
        return ok(
            {
                "data": data,
                "statistics": {
                    "average": fixed(average),
                    "min": fixed(min_value),
                    "max": fixed(max_value),
                    "days": len(data),
                },
            }
        )

    def post(self, request):
        return temperature_geometry_response(request)


class TemperatureMonthlyView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            year = _parse_int_param(request.query_params.get("year"), "year", minimum=1900, maximum=2100)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=date(year, 1, 1),
                    end=date(year, 12, 31),
                    data_type="temperature",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            grouped = {}
            for row in rows:
                try:
                    row_date = parse_iso_date(str(row.get("date", ""))[:10], "date")
                except ValueError:
                    continue
                month = row_date.month
                grouped.setdefault(month, {"temp_mean": [], "temp_min": [], "temp_max": []})
                grouped[month]["temp_mean"].append(to_float(row.get("temp_mean")))
                grouped[month]["temp_min"].append(to_float(row.get("temp_min")))
                grouped[month]["temp_max"].append(to_float(row.get("temp_max")))

            payload = []
            for month, stats in sorted(grouped.items()):
                mean_values = stats["temp_mean"]
                min_values = stats["temp_min"]
                max_values = stats["temp_max"]
                payload.append(
                    {
                        "month": month,
                        "avg_temp": fixed(sum(mean_values) / len(mean_values) if mean_values else 0),
                        "avg_min": fixed(sum(min_values) / len(min_values) if min_values else 0),
                        "avg_max": fixed(sum(max_values) / len(max_values) if max_values else 0),
                        "min_temp": fixed(min(min_values) if min_values else 0),
                        "max_temp": fixed(max(max_values) if max_values else 0),
                    }
                )
        else:
            rows = (
                TemperatureData.objects.filter(location_id=location_id, date__year=year)
                .annotate(month=ExtractMonth("date"))
                .values("month")
                .annotate(
                    avg_temp=Avg("temp_mean"),
                    avg_min=Avg("temp_min"),
                    avg_max=Avg("temp_max"),
                    min_temp=Min("temp_min"),
                    max_temp=Max("temp_max"),
                )
                .order_by("month")
            )
            payload = [
                {
                    "month": int(row["month"]),
                    "avg_temp": fixed(row["avg_temp"]),
                    "avg_min": fixed(row["avg_min"]),
                    "avg_max": fixed(row["avg_max"]),
                    "min_temp": fixed(row["min_temp"]),
                    "max_temp": fixed(row["max_temp"]),
                }
                for row in rows
            ]
        return ok({"year": year, "monthly_data": payload})


class SoilMoistureRangeView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id, start, end = _get_range_params(request)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=start,
                    end=end,
                    data_type="soil_moisture",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            data = [
                {
                    "date": str(row.get("date", ""))[:10],
                    "sm_surface": to_float(row.get("sm_surface")),
                    "sm_rootzone": to_float(row.get("sm_rootzone")),
                    "sm_profile": to_float(row.get("sm_profile")),
                    "source": row.get("source"),
                }
                for row in rows
            ]
        else:
            queryset = SoilMoistureData.objects.filter(location_id=location_id, date__range=[start, end]).order_by("date")
            data = [
                {
                    "date": row.date,
                    "sm_surface": to_float(row.sm_surface),
                    "sm_rootzone": to_float(row.sm_rootzone),
                    "sm_profile": to_float(row.sm_profile),
                    "source": row.source,
                }
                for row in queryset
            ]

        avg_surface = sum(to_float(r["sm_surface"]) for r in data) / len(data) if data else 0
        avg_rootzone = sum(to_float(r["sm_rootzone"]) for r in data) / len(data) if data else 0
        avg_profile = sum(to_float(r["sm_profile"]) for r in data) / len(data) if data else 0

        return ok(
            {
                "data": data,
                "statistics": {
                    "avg_surface": fixed(avg_surface, 4),
                    "avg_rootzone": fixed(avg_rootzone, 4),
                    "avg_profile": fixed(avg_profile, 4),
                    "days": len(data),
                },
            }
        )


class SoilMoistureMonthlyView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            year = _parse_int_param(request.query_params.get("year"), "year", minimum=1900, maximum=2100)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=date(year, 1, 1),
                    end=date(year, 12, 31),
                    data_type="soil_moisture",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            grouped = {}
            for row in rows:
                try:
                    row_date = parse_iso_date(str(row.get("date", ""))[:10], "date")
                except ValueError:
                    continue
                month = row_date.month
                grouped.setdefault(month, {"sm_surface": [], "sm_rootzone": [], "sm_profile": []})
                grouped[month]["sm_surface"].append(to_float(row.get("sm_surface")))
                grouped[month]["sm_rootzone"].append(to_float(row.get("sm_rootzone")))
                grouped[month]["sm_profile"].append(to_float(row.get("sm_profile")))

            payload = []
            for month, values in sorted(grouped.items()):
                payload.append(
                    {
                        "month": month,
                        "avg_surface": fixed(sum(values["sm_surface"]) / len(values["sm_surface"]) if values["sm_surface"] else 0, 4),
                        "avg_rootzone": fixed(sum(values["sm_rootzone"]) / len(values["sm_rootzone"]) if values["sm_rootzone"] else 0, 4),
                        "avg_profile": fixed(sum(values["sm_profile"]) / len(values["sm_profile"]) if values["sm_profile"] else 0, 4),
                    }
                )
        else:
            rows = (
                SoilMoistureData.objects.filter(location_id=location_id, date__year=year)
                .annotate(month=ExtractMonth("date"))
                .values("month")
                .annotate(
                    avg_surface=Avg("sm_surface"),
                    avg_rootzone=Avg("sm_rootzone"),
                    avg_profile=Avg("sm_profile"),
                )
                .order_by("month")
            )
            payload = [
                {
                    "month": int(row["month"]),
                    "avg_surface": fixed(row["avg_surface"], 4),
                    "avg_rootzone": fixed(row["avg_rootzone"], 4),
                    "avg_profile": fixed(row["avg_profile"], 4),
                }
                for row in rows
            ]

        return ok({"year": year, "monthly_data": payload})


class NdviRangeView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id, start, end = _get_range_params(request)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=start,
                    end=end,
                    data_type="ndvi",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            data = [
                {
                    "date": str(row.get("date", ""))[:10],
                    "ndvi_mean": to_float(row.get("ndvi_mean")),
                    "ndvi_min": to_float(row.get("ndvi_min")),
                    "ndvi_max": to_float(row.get("ndvi_max")),
                    "ndvi_stddev": to_float(row.get("ndvi_stddev")),
                    "vegetation_area_pct": to_float(row.get("vegetation_area_pct")),
                    "source": row.get("source"),
                }
                for row in rows
            ]
        else:
            queryset = NdviData.objects.filter(location_id=location_id, date__range=[start, end]).order_by("date")
            data = [
                {
                    "date": row.date,
                    "ndvi_mean": to_float(row.ndvi_mean),
                    "ndvi_min": to_float(row.ndvi_min),
                    "ndvi_max": to_float(row.ndvi_max),
                    "ndvi_stddev": to_float(row.ndvi_stddev),
                    "vegetation_area_pct": to_float(row.vegetation_area_pct),
                    "source": row.source,
                }
                for row in queryset
            ]
        avg_ndvi = sum(to_float(r["ndvi_mean"]) for r in data) / len(data) if data else 0
        min_ndvi = min((to_float(r["ndvi_min"]) for r in data), default=0)
        max_ndvi = max((to_float(r["ndvi_max"]) for r in data), default=0)
        avg_veg = sum(to_float(r["vegetation_area_pct"]) for r in data) / len(data) if data else 0

        return ok(
            {
                "data": data,
                "statistics": {
                    "average": fixed(avg_ndvi, 4),
                    "min": fixed(min_ndvi, 4),
                    "max": fixed(max_ndvi, 4),
                    "avg_vegetation_pct": fixed(avg_veg, 2),
                    "classification": ndvi_classification(avg_ndvi),
                    "records": len(data),
                },
            }
        )

    def post(self, request):
        return ndvi_geometry_response(request)


class NdviMonthlyView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            year = _parse_int_param(request.query_params.get("year"), "year", minimum=1900, maximum=2100)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=date(year, 1, 1),
                    end=date(year, 12, 31),
                    data_type="ndvi",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            grouped = {}
            for row in rows:
                try:
                    row_date = parse_iso_date(str(row.get("date", ""))[:10], "date")
                except ValueError:
                    continue
                month = row_date.month
                grouped.setdefault(month, {"ndvi_mean": [], "ndvi_min": [], "ndvi_max": [], "vegetation_area_pct": []})
                grouped[month]["ndvi_mean"].append(to_float(row.get("ndvi_mean")))
                grouped[month]["ndvi_min"].append(to_float(row.get("ndvi_min")))
                grouped[month]["ndvi_max"].append(to_float(row.get("ndvi_max")))
                grouped[month]["vegetation_area_pct"].append(to_float(row.get("vegetation_area_pct")))

            payload = []
            for month, stats in sorted(grouped.items()):
                mean_values = stats["ndvi_mean"]
                min_values = stats["ndvi_min"]
                max_values = stats["ndvi_max"]
                veg_values = stats["vegetation_area_pct"]
                avg_ndvi = sum(mean_values) / len(mean_values) if mean_values else 0
                payload.append(
                    {
                        "month": month,
                        "avg_ndvi": fixed(avg_ndvi, 4),
                        "min_ndvi": fixed(min(min_values) if min_values else 0, 4),
                        "max_ndvi": fixed(max(max_values) if max_values else 0, 4),
                        "avg_veg_pct": fixed(sum(veg_values) / len(veg_values) if veg_values else 0, 2),
                        "classification": ndvi_classification(to_float(avg_ndvi)),
                    }
                )
        else:
            rows = (
                NdviData.objects.filter(location_id=location_id, date__year=year)
                .annotate(month=ExtractMonth("date"))
                .values("month")
                .annotate(avg_ndvi=Avg("ndvi_mean"), min_ndvi=Min("ndvi_min"), max_ndvi=Max("ndvi_max"), avg_veg_pct=Avg("vegetation_area_pct"))
                .order_by("month")
            )
            payload = [
                {
                    "month": int(row["month"]),
                    "avg_ndvi": fixed(row["avg_ndvi"], 4),
                    "min_ndvi": fixed(row["min_ndvi"], 4),
                    "max_ndvi": fixed(row["max_ndvi"], 4),
                    "avg_veg_pct": fixed(row["avg_veg_pct"], 2),
                    "classification": ndvi_classification(to_float(row["avg_ndvi"])),
                }
                for row in rows
            ]
        return ok({"year": year, "monthly_data": payload})


class NdviYearlyView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            start_year = _parse_int_param(request.query_params.get("start_year"), "start_year", minimum=1900, maximum=2100)
            end_year = _parse_int_param(request.query_params.get("end_year"), "end_year", minimum=1900, maximum=2100)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        if start_year > end_year:
            return fail("Invalid year range: start_year must be <= end_year", 400, "validation_error")

        rows = (
            NdviData.objects.filter(location_id=location_id, date__year__range=[start_year, end_year])
            .annotate(year=ExtractYear("date"))
            .values("year")
            .annotate(avg_ndvi=Avg("ndvi_mean"), min_ndvi=Min("ndvi_min"), max_ndvi=Max("ndvi_max"), avg_veg_pct=Avg("vegetation_area_pct"))
            .order_by("year")
        )
        payload = [
            {
                "year": int(row["year"]),
                "avg_ndvi": fixed(row["avg_ndvi"], 4),
                "min_ndvi": fixed(row["min_ndvi"], 4),
                "max_ndvi": fixed(row["max_ndvi"], 4),
                "avg_veg_pct": fixed(row["avg_veg_pct"], 2),
            }
            for row in rows
        ]
        return ok({"yearly_data": payload})


class TvdiRangeView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id, start, end = _get_range_params(request)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=start,
                    end=end,
                    data_type="tvdi",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            data = [
                {
                    "date": str(row.get("date", ""))[:10],
                    "tvdi_mean": to_float(row.get("tvdi_mean")),
                    "tvdi_min": to_float(row.get("tvdi_min")),
                    "tvdi_max": to_float(row.get("tvdi_max")),
                    "lst_mean": to_float(row.get("lst_mean")),
                    "drought_area_pct": to_float(row.get("drought_area_pct")),
                    "drought_class": row.get("drought_class"),
                    "source": row.get("source"),
                }
                for row in rows
            ]
        else:
            queryset = TvdiData.objects.filter(location_id=location_id, date__range=[start, end]).order_by("date")
            data = [
                {
                    "date": row.date,
                    "tvdi_mean": to_float(row.tvdi_mean),
                    "tvdi_min": to_float(row.tvdi_min),
                    "tvdi_max": to_float(row.tvdi_max),
                    "lst_mean": to_float(row.lst_mean),
                    "drought_area_pct": to_float(row.drought_area_pct),
                    "drought_class": row.drought_class,
                    "source": row.source,
                }
                for row in queryset
            ]
        avg_tvdi = sum(to_float(r["tvdi_mean"]) for r in data) / len(data) if data else 0
        min_tvdi = min((to_float(r["tvdi_min"]) for r in data), default=0)
        max_tvdi = max((to_float(r["tvdi_max"]) for r in data), default=0)
        avg_lst = sum(to_float(r["lst_mean"]) for r in data) / len(data) if data else 0
        drought_days = len([r for r in data if r["drought_class"] in ("severe", "extreme")])
        drought_pct = (drought_days / len(data) * 100) if data else 0

        return ok(
            {
                "data": data,
                "statistics": {
                    "average": fixed(avg_tvdi, 4),
                    "min": fixed(min_tvdi, 4),
                    "max": fixed(max_tvdi, 4),
                    "avg_lst": fixed(avg_lst, 2),
                    "drought_days": drought_days,
                    "drought_pct": fixed(drought_pct, 2),
                    "classification": tvdi_classification(avg_tvdi),
                    "records": len(data),
                },
            }
        )

    def post(self, request):
        return tvdi_geometry_response(request)


class TvdiMonthlyView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            year = _parse_int_param(request.query_params.get("year"), "year", minimum=1900, maximum=2100)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        if _is_gee_source(request):
            try:
                rows = _fetch_gee_records(
                    location_id=location_id,
                    start=date(year, 1, 1),
                    end=date(year, 12, 31),
                    data_type="tvdi",
                    province_query=request.query_params.get("province"),
                )
            except ValueError as exc:
                return fail(str(exc), 400, "validation_error")
            except RuntimeError as exc:
                return fail(str(exc), 503, "gee_service_offline")
            except RequestException as exc:
                return fail("Failed to fetch data from GEE service", 502, "gee_service_error", {"message": str(exc)})

            grouped = {}
            for row in rows:
                try:
                    row_date = parse_iso_date(str(row.get("date", ""))[:10], "date")
                except ValueError:
                    continue
                month = row_date.month
                grouped.setdefault(
                    month,
                    {"tvdi_mean": [], "tvdi_min": [], "tvdi_max": [], "lst_mean": [], "drought_area_pct": [], "severe_days": 0},
                )
                grouped[month]["tvdi_mean"].append(to_float(row.get("tvdi_mean")))
                grouped[month]["tvdi_min"].append(to_float(row.get("tvdi_min")))
                grouped[month]["tvdi_max"].append(to_float(row.get("tvdi_max")))
                grouped[month]["lst_mean"].append(to_float(row.get("lst_mean")))
                grouped[month]["drought_area_pct"].append(to_float(row.get("drought_area_pct")))
                if row.get("drought_class") in ("severe", "extreme"):
                    grouped[month]["severe_days"] += 1

            payload = []
            for month, stats in sorted(grouped.items()):
                avg_tvdi = sum(stats["tvdi_mean"]) / len(stats["tvdi_mean"]) if stats["tvdi_mean"] else 0
                payload.append(
                    {
                        "month": month,
                        "avg_tvdi": fixed(avg_tvdi, 4),
                        "min_tvdi": fixed(min(stats["tvdi_min"]) if stats["tvdi_min"] else 0, 4),
                        "max_tvdi": fixed(max(stats["tvdi_max"]) if stats["tvdi_max"] else 0, 4),
                        "avg_lst": fixed(sum(stats["lst_mean"]) / len(stats["lst_mean"]) if stats["lst_mean"] else 0, 2),
                        "avg_drought_pct": fixed(
                            sum(stats["drought_area_pct"]) / len(stats["drought_area_pct"]) if stats["drought_area_pct"] else 0,
                            2,
                        ),
                        "severe_days": int(stats["severe_days"]),
                        "classification": tvdi_classification(to_float(avg_tvdi)),
                    }
                )
        else:
            rows = (
                TvdiData.objects.filter(location_id=location_id, date__year=year)
                .annotate(month=ExtractMonth("date"))
                .values("month")
                .annotate(
                    avg_tvdi=Avg("tvdi_mean"),
                    min_tvdi=Min("tvdi_min"),
                    max_tvdi=Max("tvdi_max"),
                    avg_lst=Avg("lst_mean"),
                    avg_drought_pct=Avg("drought_area_pct"),
                    severe_days=Count("id", filter=Q(drought_class__in=["severe", "extreme"])),
                )
                .order_by("month")
            )
            payload = []
            for row in rows:
                payload.append(
                    {
                        "month": int(row["month"]),
                        "avg_tvdi": fixed(row["avg_tvdi"], 4),
                        "min_tvdi": fixed(row["min_tvdi"], 4),
                        "max_tvdi": fixed(row["max_tvdi"], 4),
                        "avg_lst": fixed(row["avg_lst"], 2),
                        "avg_drought_pct": fixed(row["avg_drought_pct"], 2),
                        "severe_days": int(row["severe_days"]),
                        "classification": tvdi_classification(to_float(row["avg_tvdi"])),
                    }
                )
        return ok({"year": year, "monthly_data": payload})


class TvdiDroughtSummaryView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            start_year = _parse_int_param(request.query_params.get("start_year"), "start_year", minimum=1900, maximum=2100)
            end_year = _parse_int_param(request.query_params.get("end_year"), "end_year", minimum=1900, maximum=2100)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        if start_year > end_year:
            return fail("Invalid year range: start_year must be <= end_year", 400, "validation_error")

        rows = (
            TvdiData.objects.filter(location_id=location_id, date__year__range=[start_year, end_year])
            .annotate(year=ExtractYear("date"))
            .values("year", "drought_class")
            .annotate(count=Count("id"), avg_tvdi=Avg("tvdi_mean"))
            .order_by("year", "drought_class")
        )
        grouped = {}
        for row in rows:
            year = int(row["year"])
            grouped.setdefault(year, {})
            grouped[year][row["drought_class"]] = {
                "count": int(row["count"]),
                "avg_tvdi": fixed(row["avg_tvdi"], 4),
            }
        return ok({"drought_summary": grouped})


class TvdiSevereEventsView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id = _parse_int_param(request.query_params.get("location_id"), "location_id", minimum=1)
            start = parse_iso_date(request.query_params.get("start"), "start")
            end = parse_iso_date(request.query_params.get("end"), "end")
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        if start > end:
            return fail("Invalid date range: start must be before or equal to end", 400, "validation_error")
        rows = (
            TvdiData.objects.filter(
                location_id=location_id,
                date__range=[start, end],
                drought_class__in=["severe", "extreme"],
            )
            .order_by("-tvdi_mean")[:20]
            .values("date", "tvdi_mean", "lst_mean", "drought_area_pct", "drought_class")
        )
        payload = [
            {
                "date": row["date"],
                "tvdi": fixed(row["tvdi_mean"], 4),
                "lst": fixed(row["lst_mean"], 2),
                "drought_pct": fixed(row["drought_area_pct"], 2),
                "classification": row["drought_class"],
            }
            for row in rows
        ]
        return ok({"severe_events": payload})


class DashboardOverviewView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id, start, end = _get_range_params(request)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        rainfall = RainfallData.objects.filter(location_id=location_id, date__range=[start, end]).aggregate(
            avg=Avg("rainfall_mm"), total=Sum("rainfall_mm")
        )
        temperature = TemperatureData.objects.filter(location_id=location_id, date__range=[start, end]).aggregate(
            avg=Avg("temp_mean"), min=Min("temp_min"), max=Max("temp_max")
        )
        soil = SoilMoistureData.objects.filter(location_id=location_id, date__range=[start, end]).aggregate(
            avg_surface=Avg("sm_surface"), avg_root=Avg("sm_rootzone")
        )
        ndvi = NdviData.objects.filter(location_id=location_id, date__range=[start, end]).aggregate(
            avg=Avg("ndvi_mean"),
            min=Min("ndvi_min"),
            max=Max("ndvi_max"),
            veg_pct=Avg("vegetation_area_pct"),
        )
        tvdi = TvdiData.objects.filter(location_id=location_id, date__range=[start, end]).aggregate(
            avg=Avg("tvdi_mean"),
            drought_pct=Avg("drought_area_pct"),
        )
        drought_days = TvdiData.objects.filter(
            location_id=location_id,
            date__range=[start, end],
            drought_class__in=["severe", "extreme"],
        ).count()

        return ok(
            {
                "rainfall": {"total": fixed(rainfall["total"], 2), "average": fixed(rainfall["avg"], 2)},
                "temperature": {
                    "average": fixed(temperature["avg"], 2),
                    "min": fixed(temperature["min"], 2),
                    "max": fixed(temperature["max"], 2),
                },
                "soil_moisture": {"surface": fixed(soil["avg_surface"], 4), "rootzone": fixed(soil["avg_root"], 4)},
                "ndvi": {
                    "average": fixed(ndvi["avg"], 4),
                    "min": fixed(ndvi["min"], 4),
                    "max": fixed(ndvi["max"], 4),
                    "vegetation_pct": fixed(ndvi["veg_pct"], 2),
                },
                "tvdi": {
                    "average": fixed(tvdi["avg"], 4),
                    "drought_area_pct": fixed(tvdi["drought_pct"], 2),
                    "drought_days": drought_days,
                },
            }
        )


class DashboardTimeseriesView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            location_id, start, end = _get_range_params(request)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")
        rows = dashboard_timeseries(location_id, start, end)
        return ok({"timeseries": rows})
