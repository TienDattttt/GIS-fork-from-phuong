import { useEffect, useMemo, useState } from "react";
import { Bar, Line } from "react-chartjs-2";

import "../components/chartSetup";
import { apiClient, authHeaders } from "../api/client";
import StatCard from "../components/StatCard";
import SyncProgressModal from "../components/SyncProgressModal";
import { useAuth } from "../context/AuthContext";
import { buildLocationAnalysisScope, readSelectedAnalysisScope, writeSelectedAnalysisScope } from "../utils/analysisScope";
import { buildTemperatureMonthly, readGeometryScope } from "../utils/geometryAnalysis";
import { pickPreferredLocation, writeSelectedLocation } from "../utils/locationSelection";
import { getLocationCenter } from "../utils/mapGeometry";
import { toVietnameseLabel } from "../utils/viText";

const DEFAULT_LOCATION = { id: 1, name: "Quảng Trị", province: "Quảng Trị" };

function classifyTemperature(value) {
  const v = Number(value);
  if (v < 20) {
    return { level: "Mát/Lạnh", desc: "Nhiệt độ ôn hòa, thuận lợi cho canh tác." };
  }
  if (v < 30) {
    return { level: "Bình thường", desc: "Điều kiện nhiệt độ tốt cho hệ sinh thái." };
  }
  if (v < 35) {
    return { level: "Nóng", desc: "Cần bổ sung nước tưới và theo dõi stress nhiệt." };
  }
  if (v < 40) {
    return { level: "Nóng cao", desc: "Nguy cơ stress nắng và cháy rừng tăng." };
  }
  return { level: "Nóng cực đoan", desc: "Cảnh báo khẩn cấp về hạn hán và sức khỏe." };
}

export default function TemperaturePage() {
  const { logActivity, token } = useAuth();
  const [geometryScope, setGeometryScope] = useState(() => readGeometryScope());
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({
    locationId: "1",
    province: "Quảng Trị",
    startDate: "2020-01-01",
    endDate: "2020-12-31"
  });
  const [geeOnline, setGeeOnline] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("ok");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [stats, setStats] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [monthlyData, setMonthlyData] = useState([]);
  const locationOptions = locations.length > 0 ? locations : [DEFAULT_LOCATION];
  const usingGeometry = Boolean(geometryScope?.geometry);
  const selectedLocationCoordinates = useMemo(() => {
    const scopeTarget = usingGeometry ? geometryScope : locationOptions.find((item) => String(item.id) === String(form.locationId));
    if (!scopeTarget) {
      return null;
    }
    const [lat, lon] = getLocationCenter(scopeTarget);
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
      return null;
    }
    return { lat: Number(lat), lon: Number(lon) };
  }, [form.locationId, geometryScope, locationOptions, usingGeometry]);

  useEffect(() => {
    void logActivity("page_view", "temperature");
  }, [logActivity]);

  useEffect(() => {
    const run = async () => {
      try {
        const locResponse = await apiClient.get("/locations");
        const next = locResponse.data?.data || [];
        if (next.length > 0) {
          setLocations(next);
          const preferred = pickPreferredLocation(next, DEFAULT_LOCATION);
          writeSelectedLocation(preferred);
          const scope = readSelectedAnalysisScope();
          setGeometryScope(scope?.mode === "geometry" && scope.geometry ? scope : null);
          setForm((prev) => ({
            ...prev,
            locationId: String(scope?.locationId || preferred.id),
            province: toVietnameseLabel(scope?.province || preferred.province)
          }));
        } else {
          setLocations([DEFAULT_LOCATION]);
          setForm((prev) => ({
            ...prev,
            locationId: String(DEFAULT_LOCATION.id),
            province: DEFAULT_LOCATION.province
          }));
          setStatus("Chưa có dữ liệu địa điểm trong CSDL, đang dùng địa điểm mặc định Quảng Trị.");
          setStatusType("warn");
        }
      } catch {
        setLocations([DEFAULT_LOCATION]);
        setForm((prev) => ({
          ...prev,
          locationId: String(DEFAULT_LOCATION.id),
          province: DEFAULT_LOCATION.province
        }));
        setStatus("Không tải được danh sách địa điểm.");
        setStatusType("warn");
      }
    };
    void run();
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const response = await apiClient.get("/gee/status");
        const online = response.data?.data?.status === "online" && response.data?.data?.gee_initialized;
        setGeeOnline(Boolean(online));
      } catch {
        setGeeOnline(false);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const hydrateCustomLocation = (locationId, name, province) => {
    if (!locationId) {
      return;
    }
    setLocations((current) => {
      if (current.some((item) => Number(item.id) === Number(locationId))) {
        return current;
      }
      return [{ id: Number(locationId), name, province }, ...current];
    });
  };

  const loadDatabaseResults = async (locationId, province) => {
    const year = form.startDate.split("-")[0];
    const [daily, monthly] = await Promise.all([
      apiClient.get("/temperature", {
        params: { location_id: locationId, start: form.startDate, end: form.endDate, source: "db", province }
      }),
      apiClient.get("/temperature/monthly", {
        params: { location_id: locationId, year, source: "db", province }
      })
    ]);
    setDailyData(daily.data?.data?.data || []);
    setStats(daily.data?.data?.statistics || null);
    setMonthlyData(monthly.data?.data?.monthly_data || []);
  };

  const loadData = async (source = "gee") => {
    setLoading(true);
    setStatus("");
    try {
      if (usingGeometry) {
        const response = await apiClient.post(
          "/temperature",
          {
            geometry: geometryScope.geometry,
            area_name: geometryScope.name,
            province: geometryScope.province,
            source_type: geometryScope.sourceType,
            boundary_code: geometryScope.boundaryCode,
            history_id: geometryScope.historyId,
            location_id: geometryScope.locationId,
            start_date: form.startDate,
            end_date: form.endDate
          },
          { headers: authHeaders(token) }
        );
        const payload = response.data?.data || {};
        const rows = payload.data || [];
        setDailyData(rows);
        setStats(payload.statistics || null);
        setMonthlyData(buildTemperatureMonthly(rows));
        if (payload.analysis_scope?.history_id) {
          const nextScope = { ...geometryScope, historyId: payload.analysis_scope.history_id };
          setGeometryScope(nextScope);
          writeSelectedAnalysisScope(nextScope);
        }
        setStatus("Đã cập nhật kết quả nhiệt độ theo vùng geometry tùy chọn.");
        setStatusType("ok");
        return;
      }

      const year = form.startDate.split("-")[0];
      const [daily, monthly] = await Promise.all([
        apiClient.get("/temperature", {
          params: { location_id: form.locationId, start: form.startDate, end: form.endDate, source, province: form.province }
        }),
        apiClient.get("/temperature/monthly", {
          params: { location_id: form.locationId, year, source, province: form.province }
        })
      ]);

      setDailyData(daily.data?.data?.data || []);
      setStats(daily.data?.data?.statistics || null);
      setMonthlyData(monthly.data?.data?.monthly_data || []);
      setStatus(source === "db" ? "Đã tải kết quả nhiệt độ từ cơ sở dữ liệu." : "Đã cập nhật kết quả phân tích nhiệt độ.");
      setStatusType("ok");
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Không tải được dữ liệu nhiệt độ.");
      setStatusType("error");
    } finally {
      setLoading(false);
    }
  };

  const fetchFromGEE = async () => {
    if (!geeOnline) {
      setStatus("GEE service đang offline. Cần khởi động backend/scripts/api_server.py.");
      setStatusType("error");
      return;
    }
    setLoading(true);
    setSyncing(true);
    setStatus("");
    try {
      const response = await apiClient.post(
        "/gee/fetch",
        usingGeometry
          ? {
              geometry: geometryScope.geometry,
              area_name: geometryScope.name,
              province: geometryScope.province,
              source_type: geometryScope.sourceType,
              boundary_code: geometryScope.boundaryCode,
              history_id: geometryScope.historyId,
              location_id: geometryScope.locationId,
              start_date: form.startDate,
              end_date: form.endDate,
              data_types: ["temperature"]
            }
          : {
              province: form.province,
              location_id: Number(form.locationId),
              start_date: form.startDate,
              end_date: form.endDate,
              data_types: ["temperature"]
            },
        { headers: authHeaders(token) }
      );
      const records = response.data?.data?.results?.temperature?.records || 0;
      setStatus(`Đồng bộ thành công ${records} bản ghi nhiệt độ.`);
      setStatusType("ok");
      if (usingGeometry) {
        const nextLocationId = Number(response.data?.data?.location_id || 0);
        if (nextLocationId) {
          hydrateCustomLocation(nextLocationId, geometryScope.name, geometryScope.province);
          setForm((prev) => ({ ...prev, locationId: String(nextLocationId), province: geometryScope.province }));
          const nextScope = { ...geometryScope, locationId: nextLocationId, historyId: response.data?.data?.history_id || geometryScope.historyId };
          setGeometryScope(nextScope);
          writeSelectedAnalysisScope(nextScope);
          await loadDatabaseResults(nextLocationId, geometryScope.province);
        }
      } else {
        await loadData("db");
      }
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Đồng bộ GEE thất bại.");
      setStatusType("error");
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  };

  const alertInfo = useMemo(() => {
    if (!stats) {
      return null;
    }
    return classifyTemperature(stats.average);
  }, [stats]);

  const dailyChartData = {
    labels: dailyData.map((item) => item.date),
    datasets: [
      {
        label: "Nhiệt độ TB",
        data: dailyData.map((item) => Number(item.temp_mean || 0)),
        borderColor: "#d84315",
        backgroundColor: "rgba(216, 67, 21, 0.15)",
        fill: true,
        tension: 0.3
      },
      {
        label: "Nhiệt độ Max",
        data: dailyData.map((item) => Number(item.temp_max || 0)),
        borderColor: "#f57c00",
        borderDash: [6, 4]
      },
      {
        label: "Nhiệt độ Min",
        data: dailyData.map((item) => Number(item.temp_min || 0)),
        borderColor: "#0077b6",
        borderDash: [6, 4]
      }
    ]
  };

  const monthlyChartData = {
    labels: monthlyData.map((item) => `T${item.month}`),
    datasets: [
      {
        label: "Nhiệt độ TB",
        data: monthlyData.map((item) => Number(item.avg_temp || 0)),
        backgroundColor: "#d84315"
      }
    ]
  };

  const rangeChartData = {
    labels: monthlyData.map((item) => `T${item.month}`),
    datasets: [
      {
        label: "Biên độ nhiệt",
        data: monthlyData.map((item) => Number(item.max_temp || 0) - Number(item.min_temp || 0)),
        backgroundColor: "#0077b6"
      }
    ]
  };

  const rangeValue =
    stats && typeof stats.max !== "undefined" && typeof stats.min !== "undefined"
      ? (Number(stats.max) - Number(stats.min)).toFixed(1)
      : "--";

  return (
    <>
      <SyncProgressModal
        open={syncing}
        title="Đang tải dữ liệu nhiệt độ từ GEE"
        description="Hệ thống đang kết nối Google Earth Engine, lấy chuỗi nhiệt độ ERA5-Land và đồng bộ vào cơ sở dữ liệu."
      />
      <section className="card page-header">
        <h1>Phân tích Nhiệt độ</h1>
        <p>Dữ liệu ERA5-Land và thống kê biên độ nhiệt theo thời gian.</p>
      </section>

      {status && <div className={`status ${statusType}`}>{status}</div>}
      <div className={`status ${geeOnline ? "ok" : "warn"}`}>
        GEE Service: {geeOnline ? "Online" : "Offline"}
      </div>
      {usingGeometry ? (
        <div className="status ok">
          Đang phân tích theo vùng tùy chọn: <strong>{toVietnameseLabel(geometryScope.name)}</strong>. Dữ liệu được lấy trực tiếp từ GEE theo geometry đã chọn trên bản đồ.
        </div>
      ) : null}

      <section className="card controls">
        <div className="field">
          <label>Địa điểm</label>
          <select
            value={form.locationId}
            onChange={(e) => {
              const loc = locationOptions.find((item) => String(item.id) === e.target.value);
              setForm((prev) => ({
                ...prev,
                locationId: e.target.value,
                province: toVietnameseLabel(loc?.province || prev.province)
              }));
              if (loc) {
                setGeometryScope(null);
                writeSelectedLocation(loc);
                writeSelectedAnalysisScope(buildLocationAnalysisScope(loc));
              }
            }}
          >
            {locationOptions.map((location) => (
              <option key={location.id} value={location.id}>
                {toVietnameseLabel(location.name)}
              </option>
            ))}
          </select>
          {selectedLocationCoordinates ? (
            <span className="field-note">📍 lat: {selectedLocationCoordinates.lat.toFixed(4)}, lon: {selectedLocationCoordinates.lon.toFixed(4)}</span>
          ) : null}
        </div>
        <div className="field">
          <label>Từ ngày</label>
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Đến ngày</label>
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
          />
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={fetchFromGEE} disabled={loading || !geeOnline}>
            Tải từ GEE
          </button>
          <button type="button" className="btn btn-primary" onClick={loadData} disabled={loading || !geeOnline}>
            {loading ? "Đang phân tích..." : "Phân tích"}
          </button>
        </div>
      </section>

      {alertInfo && (
        <section className="alert-banner">
          <h3>{alertInfo.level}</h3>
          <p style={{ margin: 0 }}>{alertInfo.desc}</p>
        </section>
      )}

      <section className="grid-4">
        <StatCard label="Nhiệt độ TB (°C)" value={stats?.average ?? "--"} />
        <StatCard label="Nhiệt độ min (°C)" value={stats?.min ?? "--"} />
        <StatCard label="Nhiệt độ max (°C)" value={stats?.max ?? "--"} />
        <StatCard label="Biên độ nhiệt (°C)" value={rangeValue} />
      </section>

      <section className="chart-grid">
        <div className="card chart-card">
          <h3>Nhiệt độ theo thời gian</h3>
          <Line data={dailyChartData} />
        </div>
      </section>

      <section className="chart-grid two">
        <div className="card chart-card">
          <h3>Nhiệt độ trung bình theo tháng</h3>
          <Bar data={monthlyChartData} />
        </div>
        <div className="card chart-card">
          <h3>Biên độ nhiệt theo tháng</h3>
          <Bar data={rangeChartData} />
        </div>
      </section>
    </>
  );
}
