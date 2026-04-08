const STORAGE_KEY = "gis:selected-analysis-scope";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readSelectedAnalysisScope() {
  if (!canUseStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeSelectedAnalysisScope(scope) {
  if (!canUseStorage() || !scope) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
}

export function clearSelectedAnalysisScope() {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}

export function buildLocationAnalysisScope(location) {
  if (!location) {
    return null;
  }
  return {
    mode: "location",
    id: Number(location.id),
    name: location.name,
    province: location.province,
    geometry: location.geometry ?? null,
    boundaryCode: location.boundaryCode ?? null,
    adminLevel: location.adminLevel ?? null,
    centroid_lat: location.centroid_lat ?? null,
    centroid_lng: location.centroid_lng ?? null,
  };
}

export function buildGeometryAnalysisScope(scope) {
  if (!scope?.geometry) {
    return null;
  }
  return {
    mode: "geometry",
    name: scope.name || scope.area_name || "Vùng phân tích tùy chọn",
    province: scope.province || scope.province_name || scope.name || "Vùng tùy chọn",
    geometry: scope.geometry,
    sourceType: scope.sourceType || scope.source_type || "geometry",
    boundaryCode: scope.boundaryCode || scope.boundary_code || null,
    historyId: scope.historyId || scope.history_id || null,
    locationId: scope.locationId || scope.location_id || null,
    centroid_lat: scope.centroid_lat ?? null,
    centroid_lng: scope.centroid_lng ?? null,
    point: scope.point ?? null,
    radiusKm: scope.radiusKm ?? scope.radius_km ?? null,
    address: scope.address ?? null,
    metadata: scope.metadata ?? {},
  };
}
