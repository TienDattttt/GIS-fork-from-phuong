
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Layers3,
  LoaderCircle,
  LocateFixed,
  MapPin,
  PencilLine,
  Radar,
  Route,
  Save,
  Search,
  Target,
  Upload,
  X,
} from "lucide-react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";
import { useNavigate } from "react-router-dom";

import { apiClient, authHeaders } from "../api/client";
import SyncProgressModal from "../components/SyncProgressModal";
import { useAuth } from "../context/AuthContext";
import {
  buildGeometryAnalysisScope,
  buildLocationAnalysisScope,
  readSelectedAnalysisScope,
  writeSelectedAnalysisScope,
} from "../utils/analysisScope";
import { getLocationCenter, hasGeometry, normalizeGeoJson } from "../utils/mapGeometry";
import { pickPreferredLocation, writeSelectedLocation } from "../utils/locationSelection";
import { createCircleFeature, formatDistanceKm, formatDuration } from "../utils/spatial";
import { toVietnameseLabel } from "../utils/viText";

const DEFAULT_LOCATION = { id: 1, name: "Quảng Trị", province: "Quảng Trị", geometry: null, adminLevel: 1 };
const DEFAULT_CENTER = [16.75, 107.18];

const THEMATIC_OPTIONS = [
  { value: "rainfall", label: "Bản đồ lượng mưa" },
  { value: "temperature", label: "Bản đồ nhiệt độ" },
  { value: "soil_moisture", label: "Bản đồ độ ẩm đất" },
  { value: "ndvi", label: "Bản đồ NDVI" },
  { value: "tvdi", label: "Bản đồ TVDI" },
];

const MODULE_LINKS = [
  { path: "/rainfall", label: "Phân tích mưa" },
  { path: "/temperature", label: "Phân tích nhiệt độ" },
  { path: "/soil-moisture", label: "Phân tích độ ẩm đất" },
  { path: "/ndvi", label: "Phân tích NDVI" },
  { path: "/tvdi", label: "Phân tích TVDI" },
];

const VECTOR_LAYER_OPTIONS = [
  { value: "rainfall", label: "Rainfall layer", units: "mm" },
  { value: "temperature", label: "Temperature layer", units: "°C" },
  { value: "ndvi", label: "NDVI layer", units: "NDVI" },
];

function getVectorLayerColor(type, value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "#94a3b8";
  }
  const range = max - min || 1;
  const ratio = Math.max(0, Math.min(1, (numeric - min) / range));

  if (type === "rainfall") {
    const lightness = 86 - ratio * 46;
    return `hsl(207 88% ${lightness}%)`;
  }
  if (type === "temperature") {
    const hue = 54 - ratio * 44;
    return `hsl(${hue} 92% 55%)`;
  }
  return `hsl(130 55% ${82 - ratio * 42}%)`;
}

function boundaryToLocation(boundary, availableLocations = []) {
  const matchedLocation = availableLocations.find(
    (item) =>
      String(item.name || "").toLowerCase() === String(boundary.name || "").toLowerCase() ||
      String(item.province || "").toLowerCase() === String(boundary.province_name || boundary.name || "").toLowerCase()
  );

  return {
    id: boundary.location_id || matchedLocation?.id || boundary.id,
    locationId: boundary.location_id || matchedLocation?.id || null,
    boundaryCode: boundary.boundary_code,
    adminLevel: Number(boundary.admin_level || 1),
    parentCode: boundary.parent_code || null,
    name: boundary.name,
    province: boundary.province_name || boundary.name,
    geometry: boundary.geometry ?? null,
    centroid_lat: boundary.centroid_lat,
    centroid_lng: boundary.centroid_lng,
    source: boundary.source,
  };
}

function standardWardToLocation(ward, province) {
  return {
    id: `${ward.code}-${province?.boundaryCode || province?.id || "ward"}`,
    locationId: province?.locationId || province?.id || null,
    boundaryCode: ward.code,
    adminLevel: 2,
    parentCode: ward.province_code || province?.boundaryCode || null,
    name: ward.full_name || ward.name,
    province: province?.name || province?.province || "",
    geometry: null,
    centroid_lat: province?.centroid_lat ?? null,
    centroid_lng: province?.centroid_lng ?? null,
    source: "thanglequoc/vietnamese-provinces-database",
  };
}

function buildPolygonFeature(points, properties = {}) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const coordinates = points.map(([lat, lng]) => [lng, lat]);
  return {
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] },
  };
}

function buildBoundaryFeatureCollection(items = []) {
  const features = items.flatMap((item) => {
    const geoJson = normalizeGeoJson(item?.geometry);
    if (!geoJson) {
      return [];
    }

    if (geoJson.type === "FeatureCollection") {
      return (geoJson.features || [])
        .filter((feature) => feature?.geometry)
        .map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties || {}),
            __boundaryCode: item.boundaryCode || item.code || item.id,
            __boundaryName: item.name,
            __provinceName: item.province || item.province_name || "",
          },
        }));
    }

    if (geoJson.type === "Feature" && geoJson.geometry) {
      return [{
        ...geoJson,
        properties: {
          ...(geoJson.properties || {}),
          __boundaryCode: item.boundaryCode || item.code || item.id,
          __boundaryName: item.name,
          __provinceName: item.province || item.province_name || "",
        },
      }];
    }

    return [];
  });

  if (!features.length) {
    return null;
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function historyRowToScope(row) {
  return buildGeometryAnalysisScope({
    name: row.name,
    province: row.province_name,
    geometry: row.geometry,
    sourceType: row.source_type,
    boundaryCode: row.boundary_code,
    historyId: row.id,
    locationId: row.location_id,
    centroid_lat: row.centroid_lat,
    centroid_lng: row.centroid_lng,
  });
}

function resolveProvinceFromPreferred(pool, preferred) {
  return (
    pool.find((item) => String(item.boundaryCode || "") === String(preferred?.boundaryCode || "")) ||
    pool.find((item) => String(item.name || "").toLowerCase() === String(preferred?.province || preferred?.name || "").toLowerCase()) ||
    pool[0] ||
    DEFAULT_LOCATION
  );
}

function readGeoJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error("Tệp GeoJSON không hợp lệ."));
      }
    };
    reader.onerror = () => reject(new Error("Không đọc được tệp GeoJSON."));
    reader.readAsText(file, "utf-8");
  });
}

function routeGeometryToPolyline(geometry) {
  if (!geometry?.coordinates || geometry.type !== "LineString") {
    return [];
  }
  return geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

function getHotspotBadge(classification) {
  if (classification === "extreme") return "tag warn";
  if (classification === "severe") return "tag warn";
  if (classification === "moderate") return "tag custom";
  return "tag ok";
}

function MapFocusController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { animate: true, duration: 1.05 });
  }, [center, map, zoom]);
  return null;
}

function MapInteractionController({ drawMode, onDrawPoint, onPickPoint }) {
  useMapEvents({
    click(event) {
      if (drawMode) {
        onDrawPoint([event.latlng.lat, event.latlng.lng]);
        return;
      }
      onPickPoint({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

export default function MapPage() {
  const navigate = useNavigate();
  const { logActivity, token } = useAuth();

  const [allLocations, setAllLocations] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [wardMap, setWardMap] = useState({});
  const [selectedProvinceCode, setSelectedProvinceCode] = useState("");
  const [selectedWardCode, setSelectedWardCode] = useState("");
  const [selectedLocation, setSelectedLocation] = useState(DEFAULT_LOCATION);
  const [customScope, setCustomScope] = useState(() => {
    const stored = readSelectedAnalysisScope();
    return stored?.mode === "geometry" && stored.geometry ? stored : null;
  });
  const [customName, setCustomName] = useState("Vùng phân tích tùy chọn");
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState([]);
  const [recentAreas, setRecentAreas] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isWardLoading, setIsWardLoading] = useState(false);

  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("ok");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [pointAddress, setPointAddress] = useState(null);
  const [pointContext, setPointContext] = useState(null);
  const [locating, setLocating] = useState(false);

  const [radiusKm, setRadiusKm] = useState("10");
  const [routeProfile, setRouteProfile] = useState("driving");
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);

  const [layerForm, setLayerForm] = useState({
    dataType: "ndvi",
    metric: "surface",
    startDate: "2020-01-01",
    endDate: "2020-12-31",
  });
  const [layerLoading, setLayerLoading] = useState(false);
  const [activeLayer, setActiveLayer] = useState(null);
  const [layerOpacity, setLayerOpacity] = useState(0.78);
  const [vectorLayerToggles, setVectorLayerToggles] = useState({ rainfall: false, temperature: false, ndvi: false });
  const [vectorLayerData, setVectorLayerData] = useState({ rainfall: null, temperature: null, ndvi: null });
  const [vectorLayerLoading, setVectorLayerLoading] = useState("");
  const [vectorLayerNotice, setVectorLayerNotice] = useState("");
  const [vectorSyncing, setVectorSyncing] = useState(false);

  const [sampleLoading, setSampleLoading] = useState(false);
  const [pointSample, setPointSample] = useState(null);

  const [hotspotsLoading, setHotspotsLoading] = useState(false);
  const [hotspots, setHotspots] = useState([]);

  const [mapView, setMapView] = useState({ center: DEFAULT_CENTER, zoom: 7 });

  useEffect(() => {
    void logActivity("page_view", "map");
    if (customScope?.name) {
      setCustomName(customScope.name);
    }
  }, [customScope, logActivity]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!token) return;
      setHistoryLoading(true);
      try {
        const response = await apiClient.get("/analysis-areas/history", {
          params: { limit: 10 },
          headers: authHeaders(token),
        });
        setRecentAreas(response.data?.data || []);
      } catch {
        setRecentAreas([]);
      } finally {
        setHistoryLoading(false);
      }
    };

    void loadHistory();
  }, [token]);

  useEffect(() => {
    const loadProvinces = async () => {
      try {
        const locationResponse = await apiClient.get("/locations");
        const baseLocations = locationResponse.data?.data || [];
        setAllLocations(baseLocations);
        let provinceBoundaries = [];
        try {
          const boundaryResponse = await apiClient.get("/boundaries", {
            params: { level: 1, include_geometry: true, limit: 5000 },
          });
          provinceBoundaries = (boundaryResponse.data?.data || []).map((item) => boundaryToLocation(item, baseLocations));
        } catch {
          provinceBoundaries = [];
        }

        const nextProvinces = provinceBoundaries.length
          ? provinceBoundaries
          : baseLocations.map((item) => ({ ...item, locationId: item.id, adminLevel: 1, boundaryCode: null, parentCode: null }));
        const preferred = pickPreferredLocation(nextProvinces, DEFAULT_LOCATION);
        const nextProvince = resolveProvinceFromPreferred(nextProvinces, preferred);

        setProvinces(nextProvinces);
        setSelectedProvinceCode(nextProvince?.boundaryCode || "");
        setSelectedLocation(nextProvince);
        writeSelectedLocation(nextProvince);
        setMapView({ center: getLocationCenter(nextProvince), zoom: hasGeometry(nextProvince) ? 8 : 7 });

        if (!customScope) {
          writeSelectedAnalysisScope(buildLocationAnalysisScope(nextProvince));
        }

        setStatus(
          provinceBoundaries.length
            ? `Đã nạp ${nextProvinces.length} tỉnh/thành lên bản đồ. Bạn có thể tìm kiếm text, lấy vị trí hiện tại, vẽ polygon hoặc bật lớp bản đồ khí hậu.`
            : "Bản đồ đang dùng danh sách địa điểm hiện có; chưa có đầy đủ hình học hành chính cho mọi khu vực."
        );
        setStatusType(provinceBoundaries.length ? "ok" : "warn");
      } catch {
        setProvinces([DEFAULT_LOCATION]);
        setSelectedLocation(DEFAULT_LOCATION);
        setMapView({ center: DEFAULT_CENTER, zoom: 7 });
        setStatus("Không tải được dữ liệu bản đồ. Hệ thống đang dùng cấu hình mặc định của Quảng Trị.");
        setStatusType("error");
      }
    };

    void loadProvinces();
  }, []);

  const selectedProvince = useMemo(() => {
    if (!provinces.length) return DEFAULT_LOCATION;
    return provinces.find((item) => String(item.boundaryCode || "") === String(selectedProvinceCode || "")) || provinces[0];
  }, [provinces, selectedProvinceCode]);

  const wards = useMemo(() => wardMap[selectedProvinceCode] || [], [selectedProvinceCode, wardMap]);
  const selectedWard = useMemo(
    () => wards.find((item) => String(item.boundaryCode || "") === String(selectedWardCode || "")) || null,
    [selectedWardCode, wards]
  );

  useEffect(() => {
    const loadWards = async () => {
      if (!selectedProvince?.boundaryCode || wardMap[selectedProvince.boundaryCode]) return;
      setIsWardLoading(true);
      try {
        let wardItems = [];
        const boundaryResponse = await apiClient.get("/boundaries", {
          params: { level: 2, parent_code: selectedProvince.boundaryCode, include_geometry: true, limit: 5000 },
        });
        wardItems = (boundaryResponse.data?.data || []).map((item) => boundaryToLocation(item));
        if (!wardItems.length) {
          const wardResponse = await apiClient.get("/standard/wards", {
            params: { province_code: selectedProvince.boundaryCode, limit: 5000 },
          });
          wardItems = (wardResponse.data?.data || []).map((item) => standardWardToLocation(item, selectedProvince));
        }
        setWardMap((current) => ({ ...current, [selectedProvince.boundaryCode]: wardItems }));
      } catch {
        setWardMap((current) => ({ ...current, [selectedProvince.boundaryCode]: [] }));
      } finally {
        setIsWardLoading(false);
      }
    };

    setSelectedWardCode("");
    void loadWards();
  }, [selectedProvince, wardMap]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await apiClient.get("/map/geocode", { params: { q: searchQuery, limit: 6 } });
        setSearchResults(response.data?.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const selectedBoundaryFeature = useMemo(
    () => normalizeGeoJson(selectedWard?.geometry || selectedProvince?.geometry),
    [selectedProvince, selectedWard]
  );
  const subordinateBoundaryFeatureCollection = useMemo(
    () => buildBoundaryFeatureCollection(wards.filter((item) => hasGeometry(item))),
    [wards]
  );
  const customFeature = useMemo(() => normalizeGeoJson(customScope?.geometry), [customScope]);
  const drawingPreview = useMemo(() => (drawPoints.length >= 3 ? buildPolygonFeature(drawPoints, { name: customName }) : null), [customName, drawPoints]);
  const routeLine = useMemo(() => routeGeometryToPolyline(routeInfo?.geometry), [routeInfo]);

  function focusMap(center, zoom = 11) {
    setMapView({ center, zoom });
  }

  function buildSpatialScopePayload() {
    if (customScope?.geometry) {
      return { geometry: customScope.geometry, province: customScope.province || selectedProvince?.name };
    }
    if (selectedWard?.geometry) {
      return { geometry: selectedWard.geometry, province: selectedProvince?.name || selectedProvince?.province };
    }
    if (selectedProvince?.geometry) {
      return { geometry: selectedProvince.geometry, province: selectedProvince?.name || selectedProvince?.province };
    }
    return { province: selectedProvince?.province || selectedProvince?.name || DEFAULT_LOCATION.province };
  }

  function applyGeometryScope(scope) {
    const normalized = buildGeometryAnalysisScope(scope);
    if (!normalized) return;
    setCustomScope(normalized);
    setCustomName(normalized.name);
    setDrawMode(false);
    setDrawPoints([]);
    writeSelectedAnalysisScope(normalized);
    focusMap(getLocationCenter(normalized), 11);
  }

  function resetCustomScope() {
    setCustomScope(null);
    setDrawMode(false);
    setDrawPoints([]);
    setRouteInfo(null);
    const nextLocation = selectedWard || selectedProvince || DEFAULT_LOCATION;
    writeSelectedAnalysisScope(buildLocationAnalysisScope(nextLocation));
    focusMap(getLocationCenter(nextLocation), selectedWard ? 11 : 8);
  }

  async function loadPointSample(lat, lng, dataType = activeLayer?.data_type || layerForm.dataType) {
    setSampleLoading(true);
    try {
      const response = await apiClient.post("/map/point-sample", {
        data_type: dataType,
        metric: layerForm.metric,
        lat,
        lng,
        start_date: layerForm.startDate,
        end_date: layerForm.endDate,
        ...buildSpatialScopePayload(),
      });
      setPointSample(response.data?.data || null);
    } catch {
      setPointSample(null);
    } finally {
      setSampleLoading(false);
    }
  }

  async function resolvePointContext(lat, lng, options = {}) {
    const nextPoint = {
      lat,
      lng,
      label: options.label || "Điểm đã chọn",
      source: options.source || "map_click",
    };
    setSelectedPoint(nextPoint);
    focusMap([lat, lng], 12);

    try {
      const [reverseResponse, contextResponse] = await Promise.all([
        apiClient.get("/map/reverse", { params: { lat, lng } }),
        apiClient.get("/map/context", { params: { lat, lng } }),
      ]);
      setPointAddress(reverseResponse.data?.data || null);
      setPointContext(contextResponse.data?.data || null);
      if (reverseResponse.data?.data?.display_name) {
        setSelectedPoint((current) => ({ ...current, label: reverseResponse.data.data.display_name }));
      }
    } catch {
      setPointAddress(null);
      setPointContext(null);
    }

    if (activeLayer) {
      await loadPointSample(lat, lng, activeLayer.data_type);
    }
  }

  async function handleSearchResultSelect(result) {
    setSearchQuery(result.display_name || "");
    setSearchResults([]);
    await resolvePointContext(Number(result.lat), Number(result.lng), {
      label: result.display_name,
      source: "text_search",
    });

    if (result.geometry) {
      applyGeometryScope({
        name: result.display_name?.split(",")[0] || "Vùng tìm kiếm",
        province: selectedProvince?.name || selectedProvince?.province || "Vùng tìm kiếm",
        geometry: result.geometry,
        sourceType: "text_search",
        address: result.display_name,
        point: { lat: Number(result.lat), lng: Number(result.lng) },
      });
      setStatus("Đã chọn kết quả tìm kiếm làm vùng phân tích và xác định đúng tọa độ trên bản đồ.");
      setStatusType("ok");
    } else {
      setStatus("Đã xác định tọa độ từ tìm kiếm text. Bạn có thể tạo vùng bán kính quanh điểm này để phân tích.");
      setStatusType("ok");
    }
  }

  async function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("Trình duyệt hiện tại không hỗ trợ lấy vị trí.");
      setStatusType("error");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        setCurrentPosition({ lat, lng });
        await resolvePointContext(lat, lng, { label: "Vị trí hiện tại", source: "current_location" });
        setStatus("Đã lấy vị trí hiện tại của bạn và hiển thị lên bản đồ.");
        setStatusType("ok");
        setLocating(false);
      },
      () => {
        setStatus("Không lấy được vị trí hiện tại. Hãy kiểm tra quyền truy cập vị trí của trình duyệt.");
        setStatusType("error");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function handleSelectProvince(province) {
    setSelectedProvinceCode(province.boundaryCode || "");
    setSelectedWardCode("");
    setSelectedLocation(province);
    writeSelectedLocation(province);
    if (!customScope) {
      writeSelectedAnalysisScope(buildLocationAnalysisScope(province));
    }
    focusMap(getLocationCenter(province), hasGeometry(province) ? 8 : 7);
  }

  function handleSelectWard(ward) {
    setSelectedWardCode(ward.boundaryCode || "");
    setSelectedLocation(ward);
    focusMap(getLocationCenter(ward), 11);
  }

  function useSelectedBoundaryAsScope() {
    const target = selectedWard || selectedProvince;
    if (!target?.geometry) {
      setStatus("Khu vực đang chọn chưa có geometry để dùng làm vùng phân tích.");
      setStatusType("warn");
      return;
    }

    applyGeometryScope({
      name: target.name,
      province: target.province || selectedProvince?.name,
      geometry: target.geometry,
      sourceType: "boundary_click",
      boundaryCode: target.boundaryCode,
      locationId: target.locationId,
      centroid_lat: target.centroid_lat,
      centroid_lng: target.centroid_lng,
    });
    setStatus(`Đã chọn ranh giới ${toVietnameseLabel(target.name)} làm vùng phân tích.`);
    setStatusType("ok");
  }

  function beginDrawMode() {
    setDrawMode(true);
    setDrawPoints([]);
    setStatus("Chế độ vẽ vùng đã bật. Hãy click lên bản đồ để đặt các đỉnh polygon, sau đó bấm hoàn tất vùng.");
    setStatusType("ok");
  }

  function finishDrawArea() {
    const feature = buildPolygonFeature(drawPoints, { name: customName });
    if (!feature) {
      setStatus("Cần ít nhất 3 đỉnh để tạo polygon.");
      setStatusType("warn");
      return;
    }

    applyGeometryScope({
      name: customName,
      province: selectedProvince?.name || selectedProvince?.province || customName,
      geometry: feature,
      sourceType: "manual_polygon",
      point: selectedPoint,
    });
    setStatus("Đã tạo vùng polygon thủ công thành công.");
    setStatusType("ok");
  }

  function removeLastDrawPoint() {
    setDrawPoints((current) => current.slice(0, -1));
  }

  function createRadiusArea() {
    const center = selectedPoint || currentPosition;
    const radiusValue = Number(radiusKm);
    if (!center) {
      setStatus("Hãy chọn một điểm trên bản đồ, dùng tìm kiếm text hoặc lấy vị trí hiện tại trước khi tạo bán kính.");
      setStatusType("warn");
      return;
    }
    if (!Number.isFinite(radiusValue) || radiusValue <= 0) {
      setStatus("Bán kính phải lớn hơn 0 km.");
      setStatusType("warn");
      return;
    }

    const feature = createCircleFeature(center.lat, center.lng, radiusValue, 72, {
      name: `Vùng bán kính ${radiusValue} km`,
    });
    applyGeometryScope({
      name: `Vùng bán kính ${radiusValue} km`,
      province: selectedProvince?.name || selectedProvince?.province || "Vùng bán kính",
      geometry: feature,
      sourceType: "radius_buffer",
      point: center,
      radiusKm: radiusValue,
    });
    setStatus(`Đã tạo vùng bán kính ${radiusValue} km quanh điểm đang chọn.`);
    setStatusType("ok");
  }

  async function saveCurrentAreaToHistory() {
    if (!customScope || !token) {
      setStatus("Cần đăng nhập và chọn một vùng geometry trước khi lưu lịch sử.");
      setStatusType("warn");
      return;
    }

    try {
      const response = await apiClient.post(
        "/analysis-areas/history",
        {
          geometry: customScope.geometry,
          area_name: customScope.name,
          province: customScope.province,
          source_type: customScope.sourceType,
          boundary_code: customScope.boundaryCode,
          location_id: customScope.locationId,
          metadata: {
            point: customScope.point,
            radius_km: customScope.radiusKm,
            address: customScope.address,
          },
        },
        { headers: authHeaders(token) }
      );
      const historyRow = response.data?.data;
      setRecentAreas((current) => [historyRow, ...current.filter((item) => item.id !== historyRow?.id)].slice(0, 10));
      applyGeometryScope({ ...customScope, historyId: historyRow?.id });
      setStatus("Đã lưu vùng phân tích vào lịch sử tài khoản.");
      setStatusType("ok");
    } catch (error) {
      setStatus(error.response?.data?.error?.message || "Không lưu được vùng phân tích vào lịch sử.");
      setStatusType("error");
    }
  }

  async function handleGeoJsonUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = await readGeoJsonFile(file);
      const nextName = file.name.replace(/\.[^.]+$/, "") || customName;
      applyGeometryScope({
        name: nextName,
        province: selectedProvince?.name || selectedProvince?.province || nextName,
        geometry: payload,
        sourceType: "geojson_upload",
      });
      setStatus("Đã nạp GeoJSON thành công.");
      setStatusType("ok");
    } catch (error) {
      setStatus(error.message || "GeoJSON không hợp lệ.");
      setStatusType("error");
    } finally {
      event.target.value = "";
    }
  }

  async function loadThematicLayer() {
    setLayerLoading(true);
    try {
      const response = await apiClient.post("/map/layer", {
        data_type: layerForm.dataType,
        metric: layerForm.metric,
        start_date: layerForm.startDate,
        end_date: layerForm.endDate,
        ...buildSpatialScopePayload(),
      });
      const payload = response.data?.data || null;
      setActiveLayer(payload);
      setStatus(`Đã nạp ${payload?.label || "lớp bản đồ chuyên đề"} từ Google Earth Engine.`);
      setStatusType("ok");
      if (selectedPoint) {
        await loadPointSample(selectedPoint.lat, selectedPoint.lng, layerForm.dataType);
      }
    } catch (error) {
      setActiveLayer(null);
      setStatus(error.response?.data?.error?.message || "Không tải được lớp bản đồ chuyên đề từ GEE.");
      setStatusType("error");
    } finally {
      setLayerLoading(false);
    }
  }

  async function fetchVectorLayer(type) {
    if (!allLocations.length) {
      setVectorLayerNotice("Chưa có location nào trong CSDL để hiển thị lớp vector.");
      return;
    }

    const endpointMap = {
      rainfall: { path: "/rainfall", valueKey: "rainfall_mm", label: "Lượng mưa", units: "mm" },
      temperature: { path: "/temperature", valueKey: "temp_mean", label: "Nhiệt độ", units: "°C" },
      ndvi: { path: "/ndvi", valueKey: "ndvi_mean", label: "NDVI", units: "NDVI" },
    };
    const config = endpointMap[type];
    if (!config) {
      return;
    }

    setVectorLayerLoading(type);
    setVectorLayerNotice("");
    try {
      const settled = await Promise.allSettled(
        allLocations.map(async (location) => {
          const response = await apiClient.get(config.path, {
            params: {
              location_id: location.id,
              start: layerForm.startDate,
              end: layerForm.endDate,
              source: "db",
              province: location.province,
            },
          });
          const rows = response.data?.data?.data || [];
          const latest = rows[rows.length - 1];
          if (!latest) {
            return null;
          }
          const [lat, lng] = getLocationCenter(location);
          if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
            return null;
          }
          return {
            locationId: location.id,
            locationName: location.name,
            province: location.province,
            lat: Number(lat),
            lng: Number(lng),
            value: Number(latest[config.valueKey] ?? 0),
            date: latest.date,
          };
        })
      );

      const points = settled
        .filter((item) => item.status === "fulfilled" && item.value)
        .map((item) => item.value)
        .filter((item) => Number.isFinite(item.value));

      if (!points.length) {
        setVectorLayerData((current) => ({ ...current, [type]: { type, label: config.label, units: config.units, points: [] } }));
        setVectorLayerNotice(`Chưa có dữ liệu DB cho lớp ${config.label}. Bạn có thể đồng bộ từ GEE để hiển thị lớp này.`);
        return;
      }

      const values = points.map((item) => item.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const coloredPoints = points.map((item) => ({
        ...item,
        color: getVectorLayerColor(type, item.value, min, max),
      }));

      setVectorLayerData((current) => ({
        ...current,
        [type]: {
          type,
          label: config.label,
          units: config.units,
          points: coloredPoints,
          legend: { min, max },
        },
      }));
    } catch (error) {
      setVectorLayerNotice(error.response?.data?.error?.message || "Không tải được lớp vector từ dữ liệu DB.");
    } finally {
      setVectorLayerLoading("");
    }
  }

  async function toggleVectorLayer(type) {
    const nextEnabled = !vectorLayerToggles[type];
    setVectorLayerToggles((current) => ({ ...current, [type]: nextEnabled }));
    if (nextEnabled && !vectorLayerData[type]) {
      await fetchVectorLayer(type);
    }
  }

  async function syncVectorLayerFromGEE(type) {
    setVectorSyncing(true);
    setStatus("");
    try {
      const scopePayload = customScope?.geometry
        ? {
            geometry: customScope.geometry,
            area_name: customScope.name,
            province: customScope.province,
            source_type: customScope.sourceType,
            boundary_code: customScope.boundaryCode,
            history_id: customScope.historyId,
            location_id: customScope.locationId,
          }
        : {
            province: selectedProvince?.province || selectedProvince?.name || DEFAULT_LOCATION.province,
            location_id: Number(selectedProvince?.locationId || selectedProvince?.id || DEFAULT_LOCATION.id),
          };

      await apiClient.post(
        "/gee/fetch",
        {
          ...scopePayload,
          start_date: layerForm.startDate,
          end_date: layerForm.endDate,
          data_types: [type],
        },
        token ? { headers: authHeaders(token) } : undefined
      );
      await fetchVectorLayer(type);
      setVectorLayerToggles((current) => ({ ...current, [type]: true }));
      setStatus(`Đã đồng bộ dữ liệu ${type} từ GEE và làm mới lớp vector từ DB.`);
      setStatusType("ok");
    } catch (error) {
      setStatus(error.response?.data?.error?.message || "Không đồng bộ được dữ liệu từ GEE cho lớp vector.");
      setStatusType("error");
    } finally {
      setVectorSyncing(false);
    }
  }

  async function calculateRouteTo(target) {
    if (!currentPosition) {
      setStatus("Cần vị trí hiện tại để tính quãng đường thực tế.");
      setStatusType("warn");
      return;
    }
    if (!target) {
      setStatus("Chưa có điểm đích để tính quãng đường.");
      setStatusType("warn");
      return;
    }

    setRouteLoading(true);
    try {
      const response = await apiClient.get("/map/route", {
        params: {
          from_lat: currentPosition.lat,
          from_lng: currentPosition.lng,
          to_lat: target.lat,
          to_lng: target.lng,
          profile: routeProfile,
        },
      });
      setRouteInfo(response.data?.data || null);
      setStatus("Đã tính xong quãng đường thực tế trên mạng đường.");
      setStatusType("ok");
    } catch (error) {
      setRouteInfo(null);
      setStatus(error.response?.data?.error?.message || "Không tính được quãng đường.");
      setStatusType("error");
    } finally {
      setRouteLoading(false);
    }
  }

  async function loadHotspots() {
    const origin = selectedPoint || currentPosition;
    if (!origin) {
      setStatus("Hãy chọn một điểm hoặc dùng vị trí hiện tại trước khi tìm hotspot TVDI.");
      setStatusType("warn");
      return;
    }

    setHotspotsLoading(true);
    try {
      const response = await apiClient.get("/map/hotspots", {
        params: {
          lat: origin.lat,
          lng: origin.lng,
          radius_km: radiusKm,
          start: layerForm.startDate,
          end: layerForm.endDate,
          limit: 8,
          min_tvdi: 0.55,
        },
      });
      setHotspots(response.data?.data?.hotspots || []);
      setStatus("Đã truy vấn các vùng TVDI cao gần điểm đang chọn.");
      setStatusType("ok");
    } catch (error) {
      setHotspots([]);
      setStatus(error.response?.data?.error?.message || "Không truy vấn được hotspot TVDI.");
      setStatusType("error");
    } finally {
      setHotspotsLoading(false);
    }
  }

  function handleApplyHistory(row) {
    const scope = historyRowToScope(row);
    if (!scope) return;
    applyGeometryScope(scope);
    setStatus(`Đã nạp vùng gần đây: ${row.name}`);
    setStatusType("ok");
  }

  function openModule(path) {
    if (customScope?.geometry) {
      writeSelectedAnalysisScope(buildGeometryAnalysisScope(customScope));
    } else {
      const target = selectedWard || selectedProvince || selectedLocation || DEFAULT_LOCATION;
      writeSelectedAnalysisScope(buildLocationAnalysisScope(target));
    }
    writeSelectedLocation(selectedProvince || selectedLocation || DEFAULT_LOCATION);
    navigate(path);
  }

  const currentLayerLegend = activeLayer?.legend || null;
  const activeVectorLayers = VECTOR_LAYER_OPTIONS.filter((option) => vectorLayerToggles[option.value] && vectorLayerData[option.value]);
  const vectorLegendItems = activeVectorLayers
    .map((option) => ({
      type: option.value,
      label: option.label,
      units: vectorLayerData[option.value]?.units,
      legend: vectorLayerData[option.value]?.legend,
    }))
    .filter((item) => item.legend);
  const selectedSummaryCenter = getLocationCenter(customScope || selectedWard || selectedProvince || DEFAULT_LOCATION);

  return (
    <div className="panel-stack">
      <SyncProgressModal
        open={vectorSyncing}
        title="Đang đồng bộ dữ liệu lớp bản đồ từ GEE"
        description="Hệ thống đang tải dữ liệu khí hậu về cơ sở dữ liệu để hiển thị lớp vector trên bản đồ."
      />
      <section className="card page-header">
        <h1>Trung tâm WebGIS phân tích không gian</h1>
        <p>
          Tìm kiếm địa điểm bằng text, lấy vị trí hiện tại, tạo vùng bán kính hoặc polygon tùy chọn,
          tính quãng đường và hiển thị các lớp bản đồ lượng mưa, nhiệt độ, độ ẩm đất, NDVI, TVDI ngay trên bản đồ.
        </p>
      </section>

      {status ? <div className={`status ${statusType}`}>{status}</div> : null}

      <section className="card map-toolbar map-toolbar--advanced">
        <div className="field field--wide">
          <label>Tìm kiếm địa điểm bằng text</label>
          <div className="map-search-box">
            <Search size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Ví dụ: Đại học Bách khoa Đà Nẵng, Hải Châu, Quảng Trị"
            />
          </div>
          {searchLoading ? <span className="field-hint">Đang tìm kiếm tọa độ...</span> : null}
          {searchResults.length ? (
            <div className="map-search-results">
              {searchResults.map((result, index) => (
                <button
                  key={`${result.display_name}-${index}`}
                  type="button"
                  className="map-search-result"
                  onClick={() => void handleSearchResultSelect(result)}
                >
                  <strong>{result.display_name}</strong>
                  <span>
                    {Number(result.lat).toFixed(5)}, {Number(result.lng).toFixed(5)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="field">
          <label>Tỉnh/thành</label>
          <select value={selectedProvinceCode} onChange={(event) => {
            const next = provinces.find((item) => String(item.boundaryCode || "") === String(event.target.value || "")) || provinces[0];
            handleSelectProvince(next);
          }}>
            {(provinces.length ? provinces : [DEFAULT_LOCATION]).map((item) => (
              <option key={item.boundaryCode || item.id} value={item.boundaryCode || ""}>
                {toVietnameseLabel(item.name)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Phường/xã</label>
          <select value={selectedWardCode} onChange={(event) => {
            const next = wards.find((item) => String(item.boundaryCode || "") === String(event.target.value || ""));
            if (next) handleSelectWard(next);
          }}>
            <option value="">Tâm tỉnh/thành đang chọn</option>
            {wards.map((item) => (
              <option key={item.boundaryCode || item.id} value={item.boundaryCode || ""}>
                {toVietnameseLabel(item.name)}
              </option>
            ))}
          </select>
          {isWardLoading ? <span className="field-hint">Đang nạp danh sách phường/xã...</span> : null}
        </div>

        <div className="field">
          <label>Bán kính phân tích (km)</label>
          <input type="number" min="1" step="1" value={radiusKm} onChange={(event) => setRadiusKm(event.target.value)} />
        </div>

        <div className="field">
          <label>Kiểu quãng đường</label>
          <select value={routeProfile} onChange={(event) => setRouteProfile(event.target.value)}>
            <option value="driving">Ô tô</option>
            <option value="walking">Đi bộ</option>
            <option value="cycling">Xe đạp</option>
          </select>
        </div>

        <div className="field">
          <label>Từ ngày</label>
          <input type="date" value={layerForm.startDate} onChange={(event) => setLayerForm((current) => ({ ...current, startDate: event.target.value }))} />
        </div>

        <div className="field">
          <label>Đến ngày</label>
          <input type="date" value={layerForm.endDate} onChange={(event) => setLayerForm((current) => ({ ...current, endDate: event.target.value }))} />
        </div>

        <div className="field">
          <label>Lớp bản đồ chuyên đề</label>
          <select value={layerForm.dataType} onChange={(event) => setLayerForm((current) => ({ ...current, dataType: event.target.value }))}>
            {THEMATIC_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Metric độ ẩm đất</label>
          <select value={layerForm.metric} onChange={(event) => setLayerForm((current) => ({ ...current, metric: event.target.value }))} disabled={layerForm.dataType !== "soil_moisture"}>
            <option value="surface">Bề mặt</option>
            <option value="rootzone">Tầng rễ</option>
            <option value="profile">Toàn profile</option>
          </select>
        </div>
      </section>

      <section className="card map-toolbelt">
        <div className="map-toolbelt__group">
          <button type="button" className="btn btn-primary" onClick={() => void handleUseCurrentLocation()} disabled={locating}>
            {locating ? <LoaderCircle size={18} className="spin" /> : <LocateFixed size={18} />} Vị trí hiện tại
          </button>
          <button type="button" className="btn btn-secondary" onClick={useSelectedBoundaryAsScope}><Target size={18} /> Dùng ranh giới đang chọn</button>
          <button type="button" className="btn btn-secondary" onClick={beginDrawMode}><PencilLine size={18} /> Vẽ polygon</button>
          <button type="button" className="btn btn-secondary" onClick={finishDrawArea} disabled={drawPoints.length < 3}><ArrowRight size={18} /> Hoàn tất vùng</button>
          <button type="button" className="btn btn-secondary" onClick={removeLastDrawPoint} disabled={!drawPoints.length}><X size={18} /> Xóa đỉnh cuối</button>
          <button type="button" className="btn btn-secondary" onClick={createRadiusArea}><Radar size={18} /> Tạo vùng bán kính</button>
          <label className="btn btn-secondary map-upload-button"><Upload size={18} /> Upload GeoJSON<input type="file" accept=".geojson,.json" onChange={(event) => void handleGeoJsonUpload(event)} /></label>
          <button type="button" className="btn btn-secondary" onClick={() => void loadThematicLayer()} disabled={layerLoading}>{layerLoading ? <LoaderCircle size={18} className="spin" /> : <Layers3 size={18} />} Tải lớp bản đồ</button>
          <button type="button" className="btn btn-secondary" onClick={() => void loadHotspots()} disabled={hotspotsLoading}>{hotspotsLoading ? <LoaderCircle size={18} className="spin" /> : <Radar size={18} />} Tìm hotspot TVDI</button>
          <button type="button" className="btn btn-secondary" onClick={() => void calculateRouteTo(selectedPoint)} disabled={routeLoading || !selectedPoint}>{routeLoading ? <LoaderCircle size={18} className="spin" /> : <Route size={18} />} Tính quãng đường</button>
          <button type="button" className="btn btn-secondary" onClick={() => void saveCurrentAreaToHistory()} disabled={!customScope || !token}><Save size={18} /> Lưu vùng gần đây</button>
          <button type="button" className="btn btn-danger" onClick={resetCustomScope}><X size={18} /> Xóa vùng tùy chọn</button>
        </div>
        <div className="map-toolbelt__group">
          <div className="scope-pill province">Tỉnh: {toVietnameseLabel(selectedProvince?.name || DEFAULT_LOCATION.name)}</div>
          {selectedWard ? <div className="scope-pill ward">Phường/xã: {toVietnameseLabel(selectedWard.name)}</div> : null}
          {customScope ? <div className="scope-pill custom">Vùng phân tích: {customScope.name}</div> : null}
          {drawMode ? <div className="scope-pill loading">Đang vẽ polygon: {drawPoints.length} đỉnh</div> : null}
        </div>
      </section>

      <section className="map-layout">
        <article className="card map-shell">
          <div className="map-canvas">
            <div className="map-overlay-control">
              <strong>Lớp dữ liệu DB</strong>
              {VECTOR_LAYER_OPTIONS.map((option) => (
                <label key={option.value} className="map-overlay-control__item">
                  <input
                    type="checkbox"
                    checked={Boolean(vectorLayerToggles[option.value])}
                    onChange={() => void toggleVectorLayer(option.value)}
                  />
                  <span>{option.label}</span>
                  {vectorLayerLoading === option.value ? <span className="field-hint">Đang tải...</span> : null}
                </label>
              ))}
            </div>
            <MapContainer center={mapView.center} zoom={mapView.zoom} zoomControl={false} style={{ height: "100%", width: "100%" }}>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {activeLayer?.tile_url ? <TileLayer url={activeLayer.tile_url} opacity={Number(layerOpacity)} /> : null}
              <ZoomControl position="bottomright" />
              <MapFocusController center={mapView.center} zoom={mapView.zoom} />
              <MapInteractionController drawMode={drawMode} onDrawPoint={(point) => setDrawPoints((current) => [...current, point])} onPickPoint={(point) => void resolvePointContext(point.lat, point.lng)} />

              {selectedProvince && subordinateBoundaryFeatureCollection ? (
                <GeoJSON
                  key={`sub-boundaries-${selectedProvince.boundaryCode || selectedProvince.id}`}
                  data={subordinateBoundaryFeatureCollection}
                  style={(feature) => {
                    const isActive = String(feature?.properties?.__boundaryCode || "") === String(selectedWardCode || "");
                    return {
                      color: isActive ? "#d97706" : "#3b82f6",
                      weight: isActive ? 2.4 : 1.25,
                      fillColor: isActive ? "#fdba74" : "#bfdbfe",
                      fillOpacity: isActive ? 0.18 : 0.08,
                    };
                  }}
                  onEachFeature={(feature, layer) => {
                    const boundaryCode = feature?.properties?.__boundaryCode;
                    const ward = wards.find((item) => String(item.boundaryCode || item.id) === String(boundaryCode || ""));
                    const label = toVietnameseLabel(feature?.properties?.__boundaryName || ward?.name || "Đơn vị hành chính");
                    layer.bindPopup(`${label}`);
                    if (ward) {
                      layer.on({
                        click: () => handleSelectWard(ward),
                      });
                    }
                  }}
                />
              ) : null}
              {selectedBoundaryFeature ? <GeoJSON data={selectedBoundaryFeature} style={() => ({ color: "#1565c0", weight: 2, fillColor: "#bbdefb", fillOpacity: 0.18 })} /> : null}
              {customFeature ? <GeoJSON data={customFeature} style={() => ({ color: "#7b1fa2", weight: 2.5, fillColor: "#e1bee7", fillOpacity: 0.22 })} /> : null}
              {drawingPreview ? <GeoJSON data={drawingPreview} style={() => ({ color: "#00796b", weight: 2, dashArray: "10 8", fillColor: "#80cbc4", fillOpacity: 0.18 })} /> : null}
              {drawPoints.length ? <Polygon positions={drawPoints} pathOptions={{ color: "#00796b", dashArray: "8 8" }} /> : null}
              {routeLine.length ? <Polyline positions={routeLine} pathOptions={{ color: "#0b5d7a", weight: 5, dashArray: "12 10" }} /> : null}

              {currentPosition ? (
                <CircleMarker center={[currentPosition.lat, currentPosition.lng]} radius={8} pathOptions={{ color: "#006e4f", fillColor: "#00a676", fillOpacity: 1 }}>
                  <Popup>Vị trí hiện tại của bạn</Popup>
                </CircleMarker>
              ) : null}

              {selectedPoint ? (
                <CircleMarker center={[selectedPoint.lat, selectedPoint.lng]} radius={8} pathOptions={{ color: "#0f2132", fillColor: "#f57c00", fillOpacity: 1 }}>
                  <Popup>{selectedPoint.label || "Điểm đã chọn"}</Popup>
                </CircleMarker>
              ) : null}

              {hotspots.map((hotspot) => (
                <CircleMarker key={`${hotspot.location_id}-${hotspot.latest_date}`} center={[hotspot.lat, hotspot.lng]} radius={7} pathOptions={{ color: "#6a1b9a", fillColor: "#ec407a", fillOpacity: 0.95 }}>
                  <Popup>
                    <strong>{hotspot.name}</strong>
                    <br />
                    TVDI trung bình: {hotspot.avg_tvdi}
                    <br />
                    Cách điểm gốc: {formatDistanceKm(hotspot.distance_km)}
                  </Popup>
                </CircleMarker>
              ))}

              {activeVectorLayers.flatMap((option) =>
                (vectorLayerData[option.value]?.points || []).map((point) => (
                  <CircleMarker
                    key={`${option.value}-${point.locationId}-${point.date}`}
                    center={[point.lat, point.lng]}
                    radius={6}
                    pathOptions={{
                      color: point.color,
                      fillColor: point.color,
                      fillOpacity: 0.88,
                    }}
                  >
                    <Popup>
                      <strong>{toVietnameseLabel(point.locationName)}</strong>
                      <br />
                      {option.label}: {point.value.toFixed(4)} {vectorLayerData[option.value]?.units || ""}
                      <br />
                      Ngày đọc cuối: {point.date}
                    </Popup>
                  </CircleMarker>
                ))
              )}
            </MapContainer>
          </div>
        </article>

        <div className="panel-stack">
          <section className="card map-panel">
            <div className="map-panel__header">
              <div>
                <h3>Tóm tắt không gian</h3>
                <p>Thông tin GIS chính của vùng và điểm đang thao tác.</p>
              </div>
              <div className="scope-pill custom">Tâm vùng: {selectedSummaryCenter[0].toFixed(4)}, {selectedSummaryCenter[1].toFixed(4)}</div>
            </div>

            <div className="map-summary">
              <div className="map-summary__item"><MapPin size={18} /><div><strong>Điểm đang chọn</strong><span>{selectedPoint ? `${selectedPoint.lat.toFixed(5)}, ${selectedPoint.lng.toFixed(5)}` : "Chưa chọn điểm nào"}</span></div></div>
              <div className="map-summary__item"><Target size={18} /><div><strong>Phạm vi phân tích</strong><span>{customScope ? customScope.name : "Đang dùng ranh giới tỉnh/phường hoặc địa điểm đang chọn"}</span></div></div>
              <div className="map-summary__item"><Layers3 size={18} /><div><strong>Lớp chuyên đề</strong><span>{activeLayer?.label || "Chưa tải lớp bản đồ nào"}</span></div></div>
            </div>

            {pointAddress?.display_name ? <div className="map-note-block"><strong>Địa chỉ chuẩn hóa</strong><p>{pointAddress.display_name}</p></div> : null}
            {pointContext?.boundaries?.length ? <div className="map-note-block"><strong>Đơn vị hành chính chứa điểm</strong><p>{pointContext.boundaries.map((item) => item.name).join(" > ")}</p></div> : null}
            {sampleLoading ? <p className="map-panel__note">Đang lấy giá trị lớp bản đồ tại điểm...</p> : null}
            {pointSample ? (
              <div className="map-info-card">
                <strong>{pointSample.label}</strong>
                <div className="map-info-card__value">{pointSample.value ?? "Không có dữ liệu"} {pointSample.units || ""}</div>
                <span>Giai đoạn {layerForm.startDate} đến {layerForm.endDate}</span>
              </div>
            ) : null}
            {routeInfo ? (
              <div className="map-info-card">
                <strong>Quãng đường thực tế</strong>
                <div className="route-summary"><span>{formatDistanceKm(routeInfo.distance_m / 1000)}</span><span>{formatDuration(routeInfo.duration_s)}</span><span>{routeProfile}</span></div>
              </div>
            ) : null}
          </section>

          <section className="card map-panel">
            <div className="map-panel__header">
              <div>
                <h3>Lớp bản đồ chuyên đề</h3>
                <p>Tile layer từ GEE và lớp vector màu hóa từ dữ liệu DB được hiển thị song song trên cùng bản đồ.</p>
              </div>
              {activeLayer ? <div className="tag ok">Đang hiển thị</div> : null}
            </div>

            <div className="field">
              <label>Độ mờ lớp bản đồ</label>
              <input type="range" min="0.2" max="1" step="0.05" value={layerOpacity} onChange={(event) => setLayerOpacity(event.target.value)} />
            </div>

            {vectorLayerNotice ? (
              <div className="map-note-block">
                <strong>Thông báo lớp vector</strong>
                <p>{vectorLayerNotice}</p>
                <div className="table-actions">
                  {VECTOR_LAYER_OPTIONS.filter((option) => vectorLayerToggles[option.value]).map((option) => (
                    <button
                      key={`sync-${option.value}`}
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void syncVectorLayerFromGEE(option.value)}
                    >
                      Đồng bộ {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {vectorLegendItems.length ? (
              <div className="vector-legend-stack">
                {vectorLegendItems.map((item) => (
                  <div key={`vector-legend-${item.type}`} className="layer-legend-box">
                    <strong>{item.label}</strong>
                    <div
                      className="layer-legend-box__gradient"
                      style={{
                        background:
                          item.type === "rainfall"
                            ? "linear-gradient(90deg, hsl(207 88% 86%), hsl(207 88% 40%))"
                            : item.type === "temperature"
                              ? "linear-gradient(90deg, hsl(54 92% 55%), hsl(10 92% 55%))"
                              : "linear-gradient(90deg, hsl(130 55% 82%), hsl(130 55% 40%))",
                      }}
                    />
                    <div className="layer-legend-box__labels">
                      <span>{Number(item.legend.min || 0).toFixed(4)} {item.units || ""}</span>
                      <span>{Number(item.legend.max || 0).toFixed(4)} {item.units || ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {currentLayerLegend ? (
              <div className="layer-legend-box">
                <div className="layer-legend-box__gradient" style={{ background: `linear-gradient(90deg, ${currentLayerLegend.palette.join(", ")})` }} />
                <div className="layer-legend-box__labels"><span>{currentLayerLegend.min} {currentLayerLegend.units || ""}</span><span>{currentLayerLegend.max} {currentLayerLegend.units || ""}</span></div>
                <div className="map-mini-grid">
                  <div className="map-mini-card"><strong>Min</strong><span>{activeLayer?.statistics?.min ?? "-"}</span></div>
                  <div className="map-mini-card"><strong>Mean</strong><span>{activeLayer?.statistics?.mean ?? "-"}</span></div>
                  <div className="map-mini-card"><strong>Max</strong><span>{activeLayer?.statistics?.max ?? "-"}</span></div>
                </div>
              </div>
            ) : <p className="map-panel__note">Chưa có lớp chuyên đề nào được hiển thị.</p>}
          </section>

          <section className="card map-panel">
            <div className="map-panel__header">
              <div>
                <h3>Hotspot TVDI gần nhất</h3>
                <p>Truy vấn các khu vực TVDI cao trong bán kính quanh điểm đang chọn.</p>
              </div>
              <div className="scope-pill ward">Bán kính {radiusKm} km</div>
            </div>

            {hotspots.length ? (
              <div className="location-list">
                {hotspots.map((hotspot) => (
                  <div key={`${hotspot.location_id}-${hotspot.latest_date}`} className="hotspot-item">
                    <div>
                      <strong>{hotspot.name}</strong>
                      <span>{formatDistanceKm(hotspot.distance_km)} • TVDI trung bình {hotspot.avg_tvdi}</span>
                    </div>
                    <div className="hotspot-item__actions">
                      <span className={getHotspotBadge(hotspot.classification)}>{hotspot.classification}</span>
                      <button type="button" className="btn btn-secondary" onClick={() => { void resolvePointContext(Number(hotspot.lat), Number(hotspot.lng), { label: hotspot.name, source: "hotspot" }); }}>Xem</button>
                      <button type="button" className="btn btn-secondary" onClick={() => void calculateRouteTo({ lat: hotspot.lat, lng: hotspot.lng })}>Route</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="map-panel__note">Chưa có hotspot nào hoặc bạn chưa chạy truy vấn hotspot TVDI.</p>}
          </section>

          <section className="card map-panel">
            <div className="map-panel__header">
              <div>
                <h3>Vùng đã lưu và chuyển màn hình</h3>
                <p>Mở nhanh các module phân tích hiện có với vùng đang chọn.</p>
              </div>
              {historyLoading ? <LoaderCircle size={18} className="spin" /> : null}
            </div>

            <div className="map-actions map-actions--modules">
              {MODULE_LINKS.map((item) => <button key={item.path} type="button" className="btn btn-primary" onClick={() => openModule(item.path)}>{item.label}</button>)}
            </div>

            <div className="location-list recent-list">
              {recentAreas.length ? recentAreas.map((row) => (
                <button key={row.id} type="button" className="location-item" onClick={() => handleApplyHistory(row)}>
                  <div><strong>{row.name}</strong><span>{row.province_name || "Vùng tùy chọn"}</span></div>
                  <span className="tag custom">Gần đây</span>
                </button>
              )) : <div className="location-list__empty">Chưa có vùng nào trong lịch sử tài khoản.</div>}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

