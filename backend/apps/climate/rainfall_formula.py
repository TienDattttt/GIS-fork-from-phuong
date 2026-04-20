from __future__ import annotations

import math


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in kilometers between two WGS84 points."""

    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return radius_km * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def calculate_idw_rainfall(target_lat: float, target_lon: float, station_data: list[dict]) -> dict:
    """
    Estimate rainfall at a target point using Inverse Distance Weighting (IDW).

    Formula:
        P_estimated = Σ(Pi / di^2) / Σ(1 / di^2)

    Where:
        Pi = recorded rainfall at station i (mm)
        di = distance from target point to station i (km), computed from lat/lon
        n  = number of stations used
    """

    if not station_data:
        raise ValueError("At least one rainfall station is required.")

    computation_steps = []
    numerator = 0.0
    denominator = 0.0

    for index, station in enumerate(station_data, start=1):
        lat = float(station["lat"])
        lon = float(station["lon"])
        rainfall_mm = float(station["rainfall_mm"])

        # Compute the great-circle distance so the algorithm works without GIS DB functions.
        distance_km = haversine_km(target_lat, target_lon, lat, lon)

        # If the target point lies on a station, IDW should return the station's observed value directly.
        if distance_km == 0:
            return {
                "estimated_rainfall_mm": rainfall_mm,
                "formula_used": "IDW (coincident point shortcut)",
                "computation_steps": [
                    {
                        "station_index": index,
                        "Pi": rainfall_mm,
                        "distance_km": 0.0,
                        "weight": None,
                        "weighted_term": rainfall_mm,
                        "contribution_mm": rainfall_mm,
                        "note": "Target point trùng với vị trí trạm, trả về trực tiếp giá trị quan trắc.",
                    }
                ],
            }

        # IDW with power p=2 uses the inverse square of distance as the weight.
        weight = 1.0 / (distance_km**2)
        weighted_term = rainfall_mm * weight
        numerator += weighted_term
        denominator += weight
        computation_steps.append(
            {
                "station_index": index,
                "Pi": rainfall_mm,
                "distance_km": distance_km,
                "weight": weight,
                "weighted_term": weighted_term,
            }
        )

    if denominator == 0:
        raise ValueError("Could not compute IDW denominator.")

    estimated_rainfall_mm = numerator / denominator

    for step in computation_steps:
        # Show each station's normalized contribution to the final estimate for transparency.
        step["contribution_mm"] = step["weighted_term"] / denominator

    return {
        "estimated_rainfall_mm": estimated_rainfall_mm,
        "formula_used": "P_estimated = Σ(Pi / di^2) / Σ(1 / di^2)",
        "computation_steps": computation_steps,
    }
