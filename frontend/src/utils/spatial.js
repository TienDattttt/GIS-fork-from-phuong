const EARTH_RADIUS_KM = 6371;

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function toDegrees(value) {
  return (Number(value) * 180) / Math.PI;
}

export function createCircleFeature(lat, lng, radiusKm, steps = 72, properties = {}) {
  const centerLat = Number(lat);
  const centerLng = Number(lng);
  const radius = Number(radiusKm);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(radius) || radius <= 0) {
    return null;
  }

  const angularDistance = radius / EARTH_RADIUS_KM;
  const latRad = toRadians(centerLat);
  const lngRad = toRadians(centerLng);
  const coordinates = [];

  for (let index = 0; index <= steps; index += 1) {
    const bearing = (2 * Math.PI * index) / steps;
    const latPoint = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lngPoint =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(latPoint)
      );
    coordinates.push([toDegrees(lngPoint), toDegrees(latPoint)]);
  }

  return {
    type: "Feature",
    properties: {
      ...properties,
      radius_km: radius,
      center: { lat: centerLat, lng: centerLng },
    },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}

export function formatDistanceKm(distanceKm) {
  const value = Number(distanceKm || 0);
  if (value >= 100) return `${value.toFixed(0)} km`;
  if (value >= 10) return `${value.toFixed(1)} km`;
  return `${value.toFixed(2)} km`;
}

export function formatDuration(seconds) {
  const totalSeconds = Number(seconds || 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0 phút";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours <= 0) return `${minutes} phút`;
  if (minutes <= 0) return `${hours} giờ`;
  return `${hours} giờ ${minutes} phút`;
}
