from __future__ import annotations

import math

import requests
from django.conf import settings
from django.db.models import Avg, Max
from rest_framework.views import APIView
from shapely.geometry import Point, shape

from apps.common.helpers import fixed, to_float
from apps.common.responses import fail, ok

from .analysis_areas import compute_geometry_center
from .models import AdminBoundary, Location, TvdiData
from .services import parse_iso_date, tvdi_classification


THEMATIC_LAYER_TYPES = {"rainfall", "temperature", "soil_moisture", "ndvi", "tvdi"}


THEMATIC_LAYER_META = {
    "rainfall": {
        "label": "Ban do luong mua",
        "units": "mm",
        "palette": ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
        "range": [0, 300],
        "description": "Tong luong mua trong khoang thoi gian duoc chon.",
    },
    "temperature": {
        "label": "Ban do nhiet do",
        "units": "do C",
        "palette": ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"],
        "range": [10, 45],
        "description": "Nhiet do trung binh trong khoang thoi gian duoc chon.",
    },
    "soil_moisture": {
        "label": "Ban do do am dat",
        "units": "m3/m3",
        "palette": ["#f7fcf0", "#ccebc5", "#7bccc4", "#2b8cbe", "#084081"],
        "range": [0, 0.6],
        "description": "Do am dat trung binh theo layer duoc chon.",
    },
    "ndvi": {
        "label": "Ban do NDVI",
        "units": "NDVI",
        "palette": ["#8c510a", "#d8b365", "#f6e8c3", "#5ab45f", "#01665e"],
        "range": [0, 1],
        "description": "Do phu xanh va suc khoe tham thuc vat.",
    },
    "tvdi": {
        "label": "Ban do TVDI",
        "units": "TVDI",
        "palette": ["#2166ac", "#67a9cf", "#f7f7f7", "#ef8a62", "#b2182b"],
        "range": [0, 1],
        "description": "Muc do kho han theo TVDI.",
    },
}


def _parse_float_param(value, name: str, minimum: float | None = None, maximum: float | None = None) -> float:
    if value is None:
        raise ValueError(f"Missing required parameter: {name}")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {name}. Must be a number.") from exc
    if minimum is not None and parsed < minimum:
        raise ValueError(f"Invalid {name}. Must be >= {minimum}.")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"Invalid {name}. Must be <= {maximum}.")
    return parsed


def _proxy_headers():
    return {
        "User-Agent": settings.MAP_PROXY_USER_AGENT,
        "Accept-Language": "vi,en",
    }


def _extract_feature_geometry(geometry_payload):
    if not isinstance(geometry_payload, dict):
        return None
    if geometry_payload.get("type") == "Feature":
        return geometry_payload.get("geometry")
    return geometry_payload


def _shape_from_geojson(geometry_payload):
    geometry = _extract_feature_geometry(geometry_payload)
    if not geometry:
        return None
    try:
        return shape(geometry)
    except Exception:
        return None


def _location_center(location: Location):
    if location.geometry:
        lat, lng = compute_geometry_center(location.geometry)
        if lat is not None and lng is not None:
            return lat, lng

    boundary = (
        AdminBoundary.objects.filter(location_id=location.id)
        .exclude(centroid_lat__isnull=True)
        .exclude(centroid_lng__isnull=True)
        .order_by("admin_level")
        .values("centroid_lat", "centroid_lng")
        .first()
    )
    if boundary:
        return float(boundary["centroid_lat"]), float(boundary["centroid_lng"])
    return None, None


def _haversine_km(lat1, lng1, lat2, lng2):
    radius = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return radius * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def _build_geocode_item(item):
    lat = to_float(item.get("lat"))
    lng = to_float(item.get("lon"))
    geojson = item.get("geojson")
    geometry = {"type": "Feature", "properties": {}, "geometry": geojson} if isinstance(geojson, dict) else None
    return {
        "lat": lat,
        "lng": lng,
        "display_name": item.get("display_name"),
        "address": item.get("address") or {},
        "importance": item.get("importance"),
        "category": item.get("category") or item.get("class"),
        "type": item.get("type"),
        "boundingbox": item.get("boundingbox") or [],
        "geometry": geometry,
    }


def _resolve_scope_payload(data: dict):
    province = data.get("province")
    geometry = data.get("geometry")
    if not province and not isinstance(geometry, dict):
        raise ValueError("Provide either `province` or `geometry`.")
    return {
        "province": province,
        "geometry": geometry if isinstance(geometry, dict) else None,
    }


def _proxy_gee_post(endpoint: str, payload: dict, timeout: int = 120):
    response = requests.post(
        f"{settings.PYTHON_GEE_API_URL}{endpoint}",
        json=payload,
        headers=_proxy_headers(),
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()


class MapGeocodeView(APIView):
    permission_classes = []

    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        if len(query) < 2:
            return fail("Query must contain at least 2 characters.", 400, "validation_error")

        try:
            limit = min(max(int(request.query_params.get("limit", 5)), 1), 10)
        except (TypeError, ValueError):
            return fail("Invalid limit. Must be an integer.", 400, "validation_error")

        try:
            response = requests.get(
                settings.GEOCODER_SEARCH_URL,
                params={
                    "q": query,
                    "format": "jsonv2",
                    "addressdetails": 1,
                    "limit": limit,
                    "polygon_geojson": 1,
                },
                headers=_proxy_headers(),
                timeout=20,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            return fail("Failed to geocode query.", 502, "geocoder_error", {"message": str(exc)})

        payload = [_build_geocode_item(item) for item in response.json() if item.get("lat") and item.get("lon")]
        return ok(payload)


class MapReverseGeocodeView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            lat = _parse_float_param(request.query_params.get("lat"), "lat", -90, 90)
            lng = _parse_float_param(request.query_params.get("lng"), "lng", -180, 180)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        try:
            response = requests.get(
                settings.GEOCODER_REVERSE_URL,
                params={"lat": lat, "lon": lng, "format": "jsonv2", "addressdetails": 1},
                headers=_proxy_headers(),
                timeout=20,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            return fail("Failed to reverse geocode coordinates.", 502, "geocoder_error", {"message": str(exc)})

        item = response.json()
        return ok(
            {
                "lat": lat,
                "lng": lng,
                "display_name": item.get("display_name"),
                "address": item.get("address") or {},
                "category": item.get("category"),
                "type": item.get("type"),
            }
        )


class MapRouteView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            from_lat = _parse_float_param(request.query_params.get("from_lat"), "from_lat", -90, 90)
            from_lng = _parse_float_param(request.query_params.get("from_lng"), "from_lng", -180, 180)
            to_lat = _parse_float_param(request.query_params.get("to_lat"), "to_lat", -90, 90)
            to_lng = _parse_float_param(request.query_params.get("to_lng"), "to_lng", -180, 180)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        profile = (request.query_params.get("profile") or "driving").strip().lower()
        if profile not in {"driving", "walking", "cycling"}:
            return fail("Invalid profile. Allowed: driving, walking, cycling.", 400, "validation_error")

        route_url = f"{settings.ROUTING_API_URL}/{profile}/{from_lng},{from_lat};{to_lng},{to_lat}"
        try:
            response = requests.get(
                route_url,
                params={"overview": "full", "geometries": "geojson", "steps": "false"},
                headers=_proxy_headers(),
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            return fail("Failed to calculate route.", 502, "routing_error", {"message": str(exc)})

        payload = response.json()
        routes = payload.get("routes") or []
        if not routes:
            return fail("Route not found.", 404, "route_not_found", payload)

        route = routes[0]
        return ok(
            {
                "distance_m": fixed(route.get("distance"), 2),
                "duration_s": fixed(route.get("duration"), 2),
                "geometry": route.get("geometry"),
                "from": {"lat": from_lat, "lng": from_lng},
                "to": {"lat": to_lat, "lng": to_lng},
                "profile": profile,
            }
        )


class MapContextView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            lat = _parse_float_param(request.query_params.get("lat"), "lat", -90, 90)
            lng = _parse_float_param(request.query_params.get("lng"), "lng", -180, 180)
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        point = Point(lng, lat)
        containing = []

        queryset = AdminBoundary.objects.exclude(geometry__isnull=True).values(
            "id",
            "boundary_code",
            "name",
            "admin_level",
            "parent_code",
            "province_name",
            "location_id",
            "centroid_lat",
            "centroid_lng",
            "geometry",
        )

        for row in queryset:
            geom = _shape_from_geojson(row.get("geometry"))
            if not geom:
                continue
            try:
                if geom.contains(point) or geom.touches(point):
                    containing.append(
                        {
                            "id": row["id"],
                            "boundary_code": row["boundary_code"],
                            "name": row["name"],
                            "admin_level": row["admin_level"],
                            "parent_code": row["parent_code"],
                            "province_name": row["province_name"],
                            "location_id": row["location_id"],
                            "centroid_lat": row["centroid_lat"],
                            "centroid_lng": row["centroid_lng"],
                        }
                    )
            except Exception:
                continue

        containing.sort(key=lambda item: item["admin_level"])
        return ok(
            {
                "point": {"lat": lat, "lng": lng},
                "boundaries": containing,
                "province": next((item for item in containing if item["admin_level"] == 1), None),
                "ward": next((item for item in containing if item["admin_level"] == 2), None),
            }
        )


class MapLayerView(APIView):
    permission_classes = []

    def post(self, request):
        data = request.data or {}
        data_type = (data.get("data_type") or "").strip()
        if data_type not in THEMATIC_LAYER_TYPES:
            return fail(
                "Invalid data_type.",
                400,
                "validation_error",
                {"allowed": sorted(THEMATIC_LAYER_TYPES)},
            )

        try:
            _resolve_scope_payload(data)
            parse_iso_date(data.get("start_date"), "start_date")
            parse_iso_date(data.get("end_date"), "end_date")
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        try:
            payload = _proxy_gee_post(
                "/map-layer",
                {
                    "data_type": data_type,
                    "start_date": data.get("start_date"),
                    "end_date": data.get("end_date"),
                    "province": data.get("province"),
                    "geometry": data.get("geometry"),
                    "metric": data.get("metric"),
                },
                timeout=180,
            )
        except requests.RequestException as exc:
            return fail("Failed to load thematic map layer.", 502, "gee_service_error", {"message": str(exc)})

        return ok(payload)


class MapPointSampleView(APIView):
    permission_classes = []

    def post(self, request):
        data = request.data or {}
        data_type = (data.get("data_type") or "").strip()
        if data_type not in THEMATIC_LAYER_TYPES:
            return fail(
                "Invalid data_type.",
                400,
                "validation_error",
                {"allowed": sorted(THEMATIC_LAYER_TYPES)},
            )

        try:
            lat = _parse_float_param(data.get("lat"), "lat", -90, 90)
            lng = _parse_float_param(data.get("lng"), "lng", -180, 180)
            parse_iso_date(data.get("start_date"), "start_date")
            parse_iso_date(data.get("end_date"), "end_date")
        except ValueError as exc:
            return fail(str(exc), 400, "validation_error")

        try:
            payload = _proxy_gee_post(
                "/sample-point",
                {
                    "data_type": data_type,
                    "lat": lat,
                    "lng": lng,
                    "start_date": data.get("start_date"),
                    "end_date": data.get("end_date"),
                    "province": data.get("province"),
                    "geometry": data.get("geometry"),
                    "metric": data.get("metric"),
                },
                timeout=120,
            )
        except requests.RequestException as exc:
            return fail("Failed to sample value from GEE layer.", 502, "gee_service_error", {"message": str(exc)})

        return ok(payload)


class MapHotspotsView(APIView):
    permission_classes = []

    def get(self, request):
        try:
            lat = _parse_float_param(request.query_params.get("lat"), "lat", -90, 90)
            lng = _parse_float_param(request.query_params.get("lng"), "lng", -180, 180)
            radius_km = _parse_float_param(request.query_params.get("radius_km", 50), "radius_km", 0.1, 500)
            start = parse_iso_date(request.query_params.get("start"), "start")
            end = parse_iso_date(request.query_params.get("end"), "end")
            limit = min(max(int(request.query_params.get("limit", 8)), 1), 20)
        except (ValueError, TypeError) as exc:
            return fail(str(exc), 400, "validation_error")

        threshold = to_float(request.query_params.get("min_tvdi", 0.55))

        rows = (
            TvdiData.objects.filter(date__range=[start, end])
            .values("location_id", "location__name", "location__province")
            .annotate(
                avg_tvdi=Avg("tvdi_mean"),
                max_tvdi=Max("tvdi_max"),
                avg_drought_pct=Avg("drought_area_pct"),
                latest_date=Max("date"),
            )
            .order_by("-avg_tvdi")
        )

        hotspots = []
        for row in rows:
            if to_float(row.get("avg_tvdi")) < threshold:
                continue
            location = Location.objects.filter(id=row["location_id"]).first()
            if not location:
                continue
            center_lat, center_lng = _location_center(location)
            if center_lat is None or center_lng is None:
                continue
            distance_km = _haversine_km(lat, lng, center_lat, center_lng)
            if distance_km > radius_km:
                continue
            hotspots.append(
                {
                    "location_id": row["location_id"],
                    "name": row["location__name"],
                    "province": row["location__province"],
                    "lat": fixed(center_lat, 6),
                    "lng": fixed(center_lng, 6),
                    "distance_km": fixed(distance_km, 2),
                    "avg_tvdi": fixed(row["avg_tvdi"], 4),
                    "max_tvdi": fixed(row["max_tvdi"], 4),
                    "avg_drought_pct": fixed(row["avg_drought_pct"], 2),
                    "classification": tvdi_classification(to_float(row["avg_tvdi"])),
                    "latest_date": row["latest_date"],
                }
            )

        hotspots.sort(key=lambda item: (item["distance_km"], -to_float(item["avg_tvdi"])))
        return ok(
            {
                "origin": {"lat": lat, "lng": lng},
                "radius_km": fixed(radius_km, 2),
                "count": len(hotspots[:limit]),
                "hotspots": hotspots[:limit],
            }
        )
