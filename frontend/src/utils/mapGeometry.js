const DEFAULT_CENTER = [16.75, 107.18];

const PROVINCE_CENTERS = {
  "quang tri": [16.75, 107.18],
  "thua thien-hue": [16.46, 107.59],
  "thua thien hue": [16.46, 107.59],
  "da nang": [16.05, 108.2],
  "da nang city": [16.05, 108.2],
  "quang nam": [15.57, 108.02],
  "quang ngai": [15.12, 108.8],
  "binh dinh": [13.78, 109.22],
  "ha noi": [21.03, 105.85],
  "ha noi city": [21.03, 105.85],
  "thanh pho ho chi minh": [10.78, 106.7],
  "ho chi minh city": [10.78, 106.7],
  "ho chi minh": [10.78, 106.7],
  "can tho city": [10.03, 105.78],
  "hai phong city": [20.84, 106.69],
  vietnam: [16.2, 106.3],
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function collectCoordinatePairs(value, output = []) {
  if (!Array.isArray(value)) {
    return output;
  }

  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    output.push([value[0], value[1]]);
    return output;
  }

  value.forEach((item) => collectCoordinatePairs(item, output));
  return output;
}

export function normalizeGeoJson(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  if (input.type === "FeatureCollection" || input.type === "Feature") {
    return input;
  }

  if (input.type && input.coordinates) {
    return {
      type: "Feature",
      properties: {},
      geometry: input,
    };
  }

  return null;
}

export function getGeoJsonPoints(geometry) {
  const geoJson = normalizeGeoJson(geometry);
  if (!geoJson) {
    return [];
  }

  if (geoJson.type === "FeatureCollection") {
    return geoJson.features.flatMap((feature) => collectCoordinatePairs(feature?.geometry?.coordinates));
  }

  const featureGeometry = geoJson.type === "Feature" ? geoJson.geometry : geoJson;
  return collectCoordinatePairs(featureGeometry?.coordinates);
}

export function hasGeometry(location) {
  return getGeoJsonPoints(location?.geometry).length > 0;
}

export function getLocationCenter(location) {
  if (Number.isFinite(Number(location?.centroid_lat)) && Number.isFinite(Number(location?.centroid_lng))) {
    return [Number(location.centroid_lat), Number(location.centroid_lng)];
  }

  const points = getGeoJsonPoints(location?.geometry);
  if (points.length > 0) {
    const summary = points.reduce(
      (acc, [lng, lat]) => {
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          acc.lat += lat;
          acc.lng += lng;
          acc.count += 1;
        }
        return acc;
      },
      { lat: 0, lng: 0, count: 0 }
    );

    if (summary.count > 0) {
      return [summary.lat / summary.count, summary.lng / summary.count];
    }
  }

  const key = normalizeText(location?.province || location?.name);
  return PROVINCE_CENTERS[key] || DEFAULT_CENTER;
}

export function getMapLabel(location) {
  return location?.province || location?.name || "Địa điểm";
}
