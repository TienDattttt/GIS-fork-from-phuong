import { useEffect, useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDistanceKm, formatDuration, haversineDistanceKm } from "../utils/spatial";

const DEFAULT_CENTER = [16.2, 106.3];
const AI_TU_POSITION = {
  lat: 16.7748771,
  lng: 107.1402167,
  label: "Vi tri mau Ai Tu",
};
const RADIUS_OPTIONS_KM = [5, 10, 20, 50, 100];

const EMPTY_FORM = {
  id: null,
  name: "",
  stationType: "water",
  lat: "",
  lon: "",
  rainfallMm: "",
  sourceDescription: "",
};

const STATION_COLORS = {
  water: "#0077b6",
  air: "#ef476f",
  rainfall: "#2a9d8f",
};

function getMarkerColor(stationType) {
  return STATION_COLORS[stationType] || "#5c677d";
}

function RouteBoundsController({ routeLine, fallbackCenter }) {
  const map = useMap();

  useEffect(() => {
    if (routeLine.length > 1) {
      map.fitBounds(routeLine, { padding: [24, 24] });
      return;
    }
    map.flyTo(fallbackCenter, map.getZoom(), { animate: true, duration: 0.8 });
  }, [fallbackCenter, map, routeLine]);

  return null;
}

function toStationPayload(form) {
  return {
    name: form.name,
    station_type: form.stationType,
    lat: Number(form.lat),
    lon: Number(form.lon),
    rainfall_mm: form.rainfallMm === "" ? null : Number(form.rainfallMm),
    source_description: form.sourceDescription,
  };
}

export default function StationsPage() {
  const { logActivity } = useAuth();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("ok");
  const [form, setForm] = useState(EMPTY_FORM);
  const [currentPosition, setCurrentPosition] = useState(AI_TU_POSITION);
  const [usingLivePosition, setUsingLivePosition] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [activeStationId, setActiveStationId] = useState(null);
  const [activeRadiusKm, setActiveRadiusKm] = useState(null);

  useEffect(() => {
    void logActivity("page_view", "stations");
  }, [logActivity]);

  async function loadStations() {
    setLoading(true);
    try {
      const response = await apiClient.get("/climate/stations");
      setStations(response.data?.data || []);
    } catch (error) {
      setStatus(error.response?.data?.error?.message || "Khong tai duoc danh sach tram quan trac.");
      setStatusType("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStations();
  }, []);

  const stationsWithDistance = useMemo(
    () =>
      stations.map((station) => ({
        ...station,
        distanceKm: currentPosition
          ? haversineDistanceKm(currentPosition.lat, currentPosition.lng, station.lat, station.lon)
          : null,
      })),
    [currentPosition, stations]
  );

  const visibleStations = useMemo(() => {
    if (!activeRadiusKm) {
      return stationsWithDistance;
    }
    return stationsWithDistance.filter(
      (station) => station.distanceKm !== null && Number(station.distanceKm) <= Number(activeRadiusKm)
    );
  }, [activeRadiusKm, stationsWithDistance]);

  useEffect(() => {
    if (activeStationId && !visibleStations.some((station) => station.id === activeStationId)) {
      setActiveStationId(null);
      setRouteInfo(null);
    }
  }, [activeStationId, visibleStations]);

  const mapCenter = useMemo(() => {
    if (currentPosition) {
      return [Number(currentPosition.lat), Number(currentPosition.lng)];
    }

    if (activeStationId) {
      const station = visibleStations.find((item) => item.id === activeStationId);
      if (station) {
        return [Number(station.lat), Number(station.lon)];
      }
    }

    if (visibleStations.length > 0) {
      const lat = visibleStations.reduce((sum, item) => sum + Number(item.lat || 0), 0) / visibleStations.length;
      const lon = visibleStations.reduce((sum, item) => sum + Number(item.lon || 0), 0) / visibleStations.length;
      return [lat, lon];
    }

    return DEFAULT_CENTER;
  }, [activeStationId, currentPosition, visibleStations]);

  const routeLine = useMemo(() => {
    const coordinates = routeInfo?.geometry?.coordinates || [];
    return coordinates.map(([lng, lat]) => [lat, lng]);
  }, [routeInfo]);

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function toggleRadiusFilter(radiusKm) {
    setActiveRadiusKm((current) => (current === radiusKm ? null : radiusKm));
    setRouteInfo(null);
    setActiveStationId(null);
  }

  function useSampleAiTuPosition() {
    setCurrentPosition(AI_TU_POSITION);
    setUsingLivePosition(false);
    setRouteInfo(null);
    setActiveStationId(null);
    setStatus("Da dua vi tri goc ve diem mau tai Ai Tu.");
    setStatusType("ok");
  }

  function requestLivePosition() {
    if (!navigator.geolocation) {
      setStatus("Trinh duyet khong ho tro Geolocation API.");
      setStatusType("error");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCurrentPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Vi tri hien tai cua ban",
        });
        setUsingLivePosition(true);
        setRouteInfo(null);
        setActiveStationId(null);
        setStatus("Da cap nhat vi tri hien tai cua ban tren ban do.");
        setStatusType("ok");
      },
      () => {
        setStatus("Khong lay duoc vi tri hien tai. He thong van giu diem mau Ai Tu.");
        setStatusType("error");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");

    try {
      const payload = toStationPayload(form);
      if (form.id) {
        await apiClient.put(`/climate/stations/${form.id}`, payload);
        setStatus("Da cap nhat tram quan trac.");
      } else {
        await apiClient.post("/climate/stations", payload);
        setStatus("Da tao tram quan trac moi.");
      }
      setStatusType("ok");
      resetForm();
      await loadStations();
    } catch (error) {
      setStatus(error.response?.data?.error?.message || "Khong luu duoc tram quan trac.");
      setStatusType("error");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(station) {
    setForm({
      id: station.id,
      name: station.name,
      stationType: station.station_type,
      lat: station.lat,
      lon: station.lon,
      rainfallMm: station.rainfall_mm ?? "",
      sourceDescription: station.source_description || "",
    });
    setActiveStationId(station.id);
  }

  async function deleteStation(stationId) {
    try {
      await apiClient.delete(`/climate/stations/${stationId}`);
      setStatus("Da xoa tram quan trac.");
      setStatusType("ok");
      if (form.id === stationId) {
        resetForm();
      }
      await loadStations();
    } catch (error) {
      setStatus(error.response?.data?.error?.message || "Khong xoa duoc tram quan trac.");
      setStatusType("error");
    }
  }

  async function getDirections(station) {
    if (!currentPosition) {
      setStatus("Chua co vi tri goc de tinh duong di.");
      setStatusType("error");
      return;
    }

    setRouteLoading(true);
    setStatus("");
    setActiveStationId(station.id);

    try {
      const response = await apiClient.get("/map/route", {
        params: {
          from_lat: currentPosition.lat,
          from_lng: currentPosition.lng,
          to_lat: station.lat,
          to_lng: station.lon,
          profile: "driving",
        },
      });
      setRouteInfo(response.data?.data || null);
      setStatus(`Da tinh xong quang duong tu ${currentPosition.label || "diem goc hien tai"} toi tram ${station.name}.`);
      setStatusType("ok");
    } catch (error) {
      setRouteInfo(null);
      setStatus(error.response?.data?.error?.message || "Khong tinh duoc quang duong toi tram.");
      setStatusType("error");
    } finally {
      setRouteLoading(false);
    }
  }

  return (
    <div className="panel-stack">
      <section className="card page-header">
        <h1>Tram quan trac moi truong</h1>
        <p>
          Quan ly diem lay mau nuoc, chat luong khong khi va tram mua, dong thoi tinh quang duong tu vi tri goc
          hien tai toi tung tram.
        </p>
      </section>

      {status ? <div className={`status ${statusType}`}>{status}</div> : null}

      <section className="card controls">
        <form className="station-form-grid" onSubmit={handleSubmit}>
          <div className="field">
            <label>Ten tram</label>
            <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
          </div>
          <div className="field">
            <label>Loai tram</label>
            <select value={form.stationType} onChange={(event) => setForm((prev) => ({ ...prev, stationType: event.target.value }))}>
              <option value="water">water</option>
              <option value="air">air</option>
              <option value="rainfall">rainfall</option>
            </select>
          </div>
          <div className="field">
            <label>Vi do</label>
            <input type="number" step="0.000001" value={form.lat} onChange={(event) => setForm((prev) => ({ ...prev, lat: event.target.value }))} />
          </div>
          <div className="field">
            <label>Kinh do</label>
            <input type="number" step="0.000001" value={form.lon} onChange={(event) => setForm((prev) => ({ ...prev, lon: event.target.value }))} />
          </div>
          <div className="field">
            <label>Luong mua (mm)</label>
            <input
              type="number"
              step="0.01"
              value={form.rainfallMm}
              onChange={(event) => setForm((prev) => ({ ...prev, rainfallMm: event.target.value }))}
            />
          </div>
          <div className="field station-form-grid__wide">
            <label>Mo ta nguon</label>
            <input
              value={form.sourceDescription}
              onChange={(event) => setForm((prev) => ({ ...prev, sourceDescription: event.target.value }))}
              placeholder="Vi du: Song Sai Gon - cau Binh Phuoc"
            />
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Dang luu..." : form.id ? "Cap nhat tram" : "Them tram"}
            </button>
            {form.id ? (
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Huy chinh sua
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card station-map-card">
        <div className="map-panel__header">
          <div>
            <h3>Ban do tram quan trac</h3>
            <p>
              Diem goc mac dinh duoc seed tai Ai Tu. Bam vao vong ban kinh de chi hien thi cac tram nam trong pham
              vi do.
            </p>
          </div>
          <div className="station-map-meta">
            <span className={`tag ${usingLivePosition ? "ok" : "warn"}`}>
              {usingLivePosition ? "Dang dung vi tri that" : "Dang dung vi tri mau Ai Tu"}
            </span>
            {routeInfo ? (
              <div className="tag ok">
                {formatDistanceKm(Number(routeInfo.distance_m || 0) / 1000)} · {formatDuration(routeInfo.duration_s)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="station-radius-toolbar">
          <div className="station-radius-toolbar__actions">
            <button type="button" className="btn btn-secondary" onClick={requestLivePosition}>
              Dung vi tri hien tai cua toi
            </button>
            <button type="button" className="btn btn-secondary" onClick={useSampleAiTuPosition}>
              Quay ve diem mau Ai Tu
            </button>
          </div>
          <div className="station-radius-toolbar__chips">
            {RADIUS_OPTIONS_KM.map((radiusKm) => (
              <button
                key={radiusKm}
                type="button"
                className={`scope-tab ${activeRadiusKm === radiusKm ? "active" : ""}`}
                onClick={() => toggleRadiusFilter(radiusKm)}
              >
                {radiusKm} km
              </button>
            ))}
            {activeRadiusKm ? (
              <button type="button" className="scope-tab" onClick={() => toggleRadiusFilter(activeRadiusKm)}>
                Bo loc ban kinh
              </button>
            ) : null}
          </div>
        </div>

        <div className="station-map-wrapper">
          <MapContainer center={mapCenter} zoom={9} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <RouteBoundsController routeLine={routeLine} fallbackCenter={mapCenter} />

            {currentPosition
              ? [...RADIUS_OPTIONS_KM].reverse().map((radiusKm) => (
                  <Circle
                    key={`radius-${radiusKm}`}
                    center={[Number(currentPosition.lat), Number(currentPosition.lng)]}
                    radius={radiusKm * 1000}
                    pathOptions={{
                      color: activeRadiusKm === radiusKm ? "#f57c00" : "#1565c0",
                      weight: activeRadiusKm === radiusKm ? 2.6 : 1.4,
                      fillColor: activeRadiusKm === radiusKm ? "#fdba74" : "#bfdbfe",
                      fillOpacity: activeRadiusKm === radiusKm ? 0.08 : 0.03,
                      dashArray: activeRadiusKm === radiusKm ? undefined : "8 10",
                    }}
                    eventHandlers={{
                      click: () => toggleRadiusFilter(radiusKm),
                    }}
                  >
                    <Popup>
                      <strong>Vong ban kinh {radiusKm} km</strong>
                      <div>
                        {
                          stationsWithDistance.filter(
                            (station) => station.distanceKm !== null && Number(station.distanceKm) <= radiusKm
                          ).length
                        }{" "}
                        tram nam trong pham vi nay
                      </div>
                    </Popup>
                  </Circle>
                ))
              : null}

            {visibleStations.map((station) => (
              <CircleMarker
                key={station.id}
                center={[Number(station.lat), Number(station.lon)]}
                radius={activeStationId === station.id ? 10 : 7}
                pathOptions={{
                  color: getMarkerColor(station.station_type),
                  fillColor: getMarkerColor(station.station_type),
                  fillOpacity: 0.85,
                }}
              >
                <Popup>
                  <strong>{station.name}</strong>
                  <div>Loai: {station.station_type}</div>
                  <div>Luong mua: {station.rainfall_mm !== null && station.rainfall_mm !== undefined ? `${Number(station.rainfall_mm).toFixed(2)} mm` : "Chua nhap"}</div>
                  <div>Khoang cach: {station.distanceKm !== null ? formatDistanceKm(station.distanceKm) : "Chua xac dinh"}</div>
                  <div>{station.source_description || "Chua co mo ta nguon"}</div>
                </Popup>
              </CircleMarker>
            ))}

            {currentPosition ? (
              <CircleMarker
                center={[currentPosition.lat, currentPosition.lng]}
                radius={8}
                pathOptions={{ color: "#5c677d", fillColor: "#1d3557", fillOpacity: 0.9 }}
              >
                <Popup>{currentPosition.label || "Vi tri goc hien tai"}</Popup>
              </CircleMarker>
            ) : null}

            {routeLine.length > 1 ? <Polyline positions={routeLine} pathOptions={{ color: "#ff6b35", weight: 4 }} /> : null}
          </MapContainer>
        </div>

        <div className="station-legend">
          <span><i style={{ background: STATION_COLORS.water }} /> water</span>
          <span><i style={{ background: STATION_COLORS.air }} /> air</span>
          <span><i style={{ background: STATION_COLORS.rainfall }} /> rainfall</span>
          {activeRadiusKm ? <span><i style={{ background: "#f57c00" }} /> loc trong {activeRadiusKm} km</span> : null}
        </div>
      </section>

      <section className="card table-card">
        <div className="map-panel__header">
          <div>
            <h3>Danh sach tram</h3>
            <p>
              {loading
                ? "Dang tai danh sach tram..."
                : activeRadiusKm
                  ? `${visibleStations.length}/${stations.length} tram nam trong ban kinh ${activeRadiusKm} km tu ${currentPosition?.label || "diem goc hien tai"}.`
                  : `${stations.length} tram dang duoc quan ly.`}
            </p>
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Lat</th>
              <th>Lon</th>
              <th>Rainfall (mm)</th>
              <th>Source description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleStations.map((station) => (
              <tr key={station.id}>
                <td>{station.name}</td>
                <td>{station.station_type}</td>
                <td>{Number(station.lat).toFixed(6)}</td>
                <td>{Number(station.lon).toFixed(6)}</td>
                <td>{station.rainfall_mm !== null && station.rainfall_mm !== undefined ? Number(station.rainfall_mm).toFixed(2) : "-"}</td>
                <td>{station.source_description || "-"}</td>
                <td>
                  <div className="table-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => startEdit(station)}>
                      Sua
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void getDirections(station)} disabled={routeLoading}>
                      {routeLoading && activeStationId === station.id ? "Dang tinh..." : "Get directions"}
                    </button>
                    <button type="button" className="btn btn-danger" onClick={() => void deleteStation(station.id)}>
                      Xoa
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!visibleStations.length && !loading ? (
              <tr>
                <td colSpan={7}>
                  {stations.length ? "Khong co tram nao nam trong ban kinh dang chon." : "Chua co tram quan trac nao."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
