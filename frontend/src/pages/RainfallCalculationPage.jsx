import { useEffect, useMemo, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMapEvents } from "react-leaflet";

import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { normalizeGeoJson } from "../utils/mapGeometry";

const QUANG_TRI_CENTER = {
  lat: "16.750000",
  lon: "107.180000",
};

const STATION_COLORS = {
  water: "#0077b6",
  air: "#ef476f",
  rainfall: "#2a9d8f",
};

function TargetPicker({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function emptyStationRow() {
  return { lat: "", lon: "", rainfall_mm: "" };
}

function buildTargetGeometry(lat, lon) {
  const lngNumber = Number(lon);
  const latNumber = Number(lat);
  const delta = 0.005;
  return {
    type: "Feature",
    properties: {
      name: "Diem muc tieu IDW",
      source_type: "manual-point",
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [lngNumber - delta, latNumber - delta],
        [lngNumber + delta, latNumber - delta],
        [lngNumber + delta, latNumber + delta],
        [lngNumber - delta, latNumber + delta],
        [lngNumber - delta, latNumber - delta],
      ]],
    },
  };
}

function getMarkerColor(stationType) {
  return STATION_COLORS[stationType] || "#5c677d";
}

function buildBoundaryLabel(context) {
  if (!context) {
    return "Chua xac dinh";
  }

  const parts = [];
  if (context.ward?.name) {
    parts.push(context.ward.name);
  }
  if (context.province?.name && context.province?.name !== context.ward?.name) {
    parts.push(context.province.name);
  }
  return parts.length > 0 ? parts.join(" / ") : "Chua xac dinh";
}

export default function RainfallCalculationPage() {
  const { logActivity } = useAuth();
  const [stations, setStations] = useState([emptyStationRow()]);
  const [monitoringStations, setMonitoringStations] = useState([]);
  const [target, setTarget] = useState(QUANG_TRI_CENTER);
  const [targetContext, setTargetContext] = useState(null);
  const [targetBoundaryGeometry, setTargetBoundaryGeometry] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ startDate: "2020-01-01", endDate: "2020-12-31" });
  const [result, setResult] = useState(null);
  const [geeSample, setGeeSample] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("ok");
  const [stationHint, setStationHint] = useState("");

  useEffect(() => {
    void logActivity("page_view", "rainfall-calculation");
  }, [logActivity]);

  async function loadTargetContext(lat, lon) {
    setContextLoading(true);
    try {
      const response = await apiClient.get("/map/context", {
        params: {
          lat,
          lng: lon,
        },
      });
      const context = response.data?.data || null;
      setTargetContext(context);

      const smallestBoundary = context?.ward || context?.province || context?.boundaries?.[0];
      if (smallestBoundary?.admin_level && smallestBoundary?.boundary_code) {
        try {
          const boundaryResponse = await apiClient.get(
            `/boundaries/${smallestBoundary.admin_level}/${smallestBoundary.boundary_code}`
          );
          setTargetBoundaryGeometry(normalizeGeoJson(boundaryResponse.data?.data?.geometry));
        } catch {
          setTargetBoundaryGeometry(null);
        }
      } else {
        setTargetBoundaryGeometry(null);
      }
    } catch {
      setTargetContext(null);
      setTargetBoundaryGeometry(null);
    } finally {
      setContextLoading(false);
    }
  }

  useEffect(() => {
    const loadStations = async () => {
      try {
        const [rainfallResponse, allStationResponse] = await Promise.all([
          apiClient.get("/climate/stations", { params: { station_type: "rainfall" } }),
          apiClient.get("/climate/stations"),
        ]);

        const rainfallStations = rainfallResponse.data?.data || [];
        const allStations = allStationResponse.data?.data || [];
        setMonitoringStations(allStations);

        if (rainfallStations.length > 0) {
          setStations(
            rainfallStations.map((row) => ({
              lat: row.lat,
              lon: row.lon,
              rainfall_mm: row.rainfall_mm ?? "",
            }))
          );
          setStationHint(`Da nap ${rainfallStations.length} tram loai rainfall vao bang input.`);
          return;
        }

        if (allStations.length > 0) {
          setStations(
            allStations.map((row) => ({
              lat: row.lat,
              lon: row.lon,
              rainfall_mm: row.rainfall_mm ?? "",
            }))
          );
          setStationHint(
            "He thong chua co tram loai rainfall. Ban do van hien tat ca tram quan trac va se tu nap rainfall_mm neu ban da nhap o tab Tram quan trac."
          );
        }
      } catch {
        setStationHint("Khong tai duoc monitoring stations. Ban van co the nhap tay cac tram de tinh IDW.");
      }
    };

    void loadStations();
    void loadTargetContext(Number(QUANG_TRI_CENTER.lat), Number(QUANG_TRI_CENTER.lon));
  }, []);

  const mapCenter = useMemo(() => {
    const lat = Number(target.lat);
    const lon = Number(target.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return [lat, lon];
    }

    const valid = monitoringStations.filter(
      (item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))
    );
    if (valid.length > 0) {
      return [
        valid.reduce((sum, item) => sum + Number(item.lat), 0) / valid.length,
        valid.reduce((sum, item) => sum + Number(item.lon), 0) / valid.length,
      ];
    }
    return [Number(QUANG_TRI_CENTER.lat), Number(QUANG_TRI_CENTER.lon)];
  }, [monitoringStations, target.lat, target.lon]);

  function updateStation(index, field, value) {
    setStations((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  function addStationRow() {
    setStations((current) => [...current, emptyStationRow()]);
  }

  function removeStationRow(index) {
    setStations((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleTargetPick(lat, lon) {
    const nextTarget = { lat: lat.toFixed(6), lon: lon.toFixed(6) };
    setTarget(nextTarget);
    await loadTargetContext(Number(nextTarget.lat), Number(nextTarget.lon));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("");

    const normalizedStations = stations
      .filter(
        (station) =>
          station.lat !== "" &&
          station.lon !== "" &&
          station.rainfall_mm !== "" &&
          Number.isFinite(Number(station.lat)) &&
          Number.isFinite(Number(station.lon)) &&
          Number.isFinite(Number(station.rainfall_mm))
      )
      .map((station) => ({
        lat: Number(station.lat),
        lon: Number(station.lon),
        rainfall_mm: Number(station.rainfall_mm),
      }));

    if (normalizedStations.length === 0) {
      setStatus(
        "Chua co du lieu luong mua cho tram nao. Hien tai he thong moi co toa do tram, ban can nhap it nhat mot gia tri rainfall_mm de tinh IDW."
      );
      setStatusType("error");
      setResult(null);
      setGeeSample(null);
      return;
    }

    setLoading(true);

    try {
      const idwResponse = await apiClient.post("/climate/rainfall/calculate", {
        target_lat: Number(target.lat),
        target_lon: Number(target.lon),
        stations: normalizedStations,
      });
      setResult(idwResponse.data?.data || null);

      const geeResponse = await apiClient.post("/map/point-sample", {
        data_type: "rainfall",
        lat: Number(target.lat),
        lng: Number(target.lon),
        start_date: dateRange.startDate,
        end_date: dateRange.endDate,
        geometry: buildTargetGeometry(target.lat, target.lon),
      });
      setGeeSample(geeResponse.data?.data || null);
      setStatus("Da tinh xong luong mua theo thuat toan IDW va lay gia tri doi chieu tu GEE.");
      setStatusType("ok");
    } catch (error) {
      setStatus(error.response?.data?.error?.message || "Khong tinh duoc luong mua theo IDW.");
      setStatusType("error");
      setGeeSample(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel-stack">
      <section className="card page-header">
        <h1>Tinh luong mua theo thuat toan IDW</h1>
        <p>Trang nay trinh bay cong thuc noi suy mua doc lap voi GEE va doi chieu voi du lieu CHIRPS tai cung diem muc tieu.</p>
      </section>

      {status ? <div className={`status ${statusType}`}>{status}</div> : null}

      <section className="card table-card">
        <h3>1. Formula</h3>
        <div className="formula-box">
          <div className="formula-box__title">Thuat toan IDW</div>
          <div className="formula-box__equation">
            P<sub>estimated</sub> = Σ(P<sub>i</sub> / d<sub>i</sub>
            <sup>2</sup>) / Σ(1 / d<sub>i</sub>
            <sup>2</sup>)
          </div>
          <p>Trong do P<sub>i</sub> la luong mua tai tram i, con d<sub>i</sub> la khoang cach tu diem can tinh den tram i.</p>
          <div className="formula-box__title">Khoang cach Haversine</div>
          <div className="formula-box__equation">d = 2R · atan2(√a, √(1-a))</div>
          <p>a = sin²(Δφ/2) + cos(φ₁) · cos(φ₂) · sin²(Δλ/2), voi R = 6371 km.</p>
        </div>
      </section>

      <form className="panel-stack" onSubmit={handleSubmit}>
        <section className="card table-card">
          <div className="map-panel__header">
            <div>
              <h3>2. Input stations</h3>
              <p>Cac hang co the duoc nhap tay hoac prefill tu monitoring stations loai rainfall.</p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={addStationRow}>
              Them hang
            </button>
          </div>
          {stationHint ? <div className="field-note">{stationHint}</div> : null}
          <table className="data-table">
            <thead>
              <tr>
                <th>Lat</th>
                <th>Lon</th>
                <th>Rainfall (mm)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stations.map((station, index) => (
                <tr key={`station-${index}`}>
                  <td><input type="number" step="0.000001" value={station.lat} onChange={(event) => updateStation(index, "lat", event.target.value)} /></td>
                  <td><input type="number" step="0.000001" value={station.lon} onChange={(event) => updateStation(index, "lon", event.target.value)} /></td>
                  <td><input type="number" step="0.01" value={station.rainfall_mm} onChange={(event) => updateStation(index, "rainfall_mm", event.target.value)} /></td>
                  <td>
                    <button type="button" className="btn btn-danger" onClick={() => removeStationRow(index)} disabled={stations.length === 1}>
                      Xoa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card controls">
          <div className="field">
            <label>Target lat</label>
            <input type="number" step="0.000001" value={target.lat} onChange={(event) => setTarget((prev) => ({ ...prev, lat: event.target.value }))} />
          </div>
          <div className="field">
            <label>Target lon</label>
            <input type="number" step="0.000001" value={target.lon} onChange={(event) => setTarget((prev) => ({ ...prev, lon: event.target.value }))} />
          </div>
          <div className="field">
            <label>Tu ngay</label>
            <input type="date" value={dateRange.startDate} onChange={(event) => setDateRange((prev) => ({ ...prev, startDate: event.target.value }))} />
          </div>
          <div className="field">
            <label>Den ngay</label>
            <input type="date" value={dateRange.endDate} onChange={(event) => setDateRange((prev) => ({ ...prev, endDate: event.target.value }))} />
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Dang tinh..." : "Tinh luong mua"}
            </button>
          </div>
        </section>

        <section className="card station-map-card">
          <div className="map-panel__header">
            <div>
              <h3>3. Target point</h3>
              <p>Click truc tiep tren ban do de chon diem muc tieu phuc vu tinh toan. Diem nay se hien ro dang nam trong don vi hanh chinh nao.</p>
            </div>
          </div>
          <div className="map-mini-grid">
            <div className="map-mini-card">
              <strong>Toa do diem chon</strong>
              <span>{Number(target.lat).toFixed(6)}, {Number(target.lon).toFixed(6)}</span>
            </div>
            <div className="map-mini-card">
              <strong>Ranh gioi chua diem</strong>
              <span>{contextLoading ? "Dang xac dinh..." : buildBoundaryLabel(targetContext)}</span>
            </div>
            <div className="map-mini-card">
              <strong>Monitoring stations</strong>
              <span>{monitoringStations.length} tram dang hien thi tren ban do</span>
            </div>
          </div>
          <div className="station-map-wrapper">
            <MapContainer center={mapCenter} zoom={9} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <TargetPicker onPick={(lat, lon) => void handleTargetPick(lat, lon)} />
              {targetBoundaryGeometry ? (
                <GeoJSON
                  data={targetBoundaryGeometry}
                  style={() => ({
                    color: "#1565c0",
                    weight: 2,
                    fillColor: "#90caf9",
                    fillOpacity: 0.14,
                  })}
                />
              ) : null}
              {monitoringStations.map((station) =>
                Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lon)) ? (
                  <CircleMarker
                    key={`monitoring-station-${station.id}`}
                    center={[Number(station.lat), Number(station.lon)]}
                    radius={6}
                    pathOptions={{
                      color: getMarkerColor(station.station_type),
                      fillColor: getMarkerColor(station.station_type),
                      fillOpacity: 0.85,
                    }}
                  >
                    <Popup>
                      <strong>{station.name}</strong>
                      <div>Loai: {station.station_type}</div>
                      <div>{station.source_description || "Chua co mo ta nguon"}</div>
                    </Popup>
                  </CircleMarker>
                ) : null
              )}
              {Number.isFinite(Number(target.lat)) && Number.isFinite(Number(target.lon)) ? (
                <CircleMarker center={[Number(target.lat), Number(target.lon)]} radius={8} pathOptions={{ color: "#ef476f", fillColor: "#ef476f", fillOpacity: 0.95 }}>
                  <Popup>
                    <strong>Diem muc tieu IDW</strong>
                    <div>{buildBoundaryLabel(targetContext)}</div>
                  </Popup>
                </CircleMarker>
              ) : null}
            </MapContainer>
          </div>
        </section>
      </form>

      <section className="card table-card">
        <h3>4. Results</h3>
        {result ? (
          <>
            <div className="grid-4">
              <div className="stat card"><h4>IDW estimate</h4><p>{Number(result.estimated_rainfall_mm || 0).toFixed(4)} mm</p></div>
              <div className="stat card"><h4>Cong thuc dung</h4><p>{result.formula_used}</p></div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Pi (mm)</th>
                  <th>di (km)</th>
                  <th>Weight</th>
                  <th>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {(result.computation_steps || []).map((step) => (
                  <tr key={step.station_index}>
                    <td>{step.station_index}</td>
                    <td>{Number(step.Pi || 0).toFixed(4)}</td>
                    <td>{step.distance_km === null ? "-" : Number(step.distance_km).toFixed(6)}</td>
                    <td>{Number(step.weight || 0).toFixed(8)}</td>
                    <td>{Number(step.contribution_mm || 0).toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p>Chua co ket qua. Hay nhap du lieu tram, chon diem muc tieu va chay thuat toan.</p>
        )}
      </section>

      <section className="card table-card">
        <h3>5. Comparison</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Rainfall (mm)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>IDW (calculated)</td>
              <td>{result ? Number(result.estimated_rainfall_mm || 0).toFixed(4) : "-"}</td>
            </tr>
            <tr>
              <td>GEE (CHIRPS)</td>
              <td>{geeSample?.value !== undefined && geeSample?.value !== null ? Number(geeSample.value).toFixed(4) : "-"}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
