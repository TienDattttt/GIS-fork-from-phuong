import { useEffect, useMemo, useState } from "react";
import { Bar, Doughnut, Line } from "react-chartjs-2";

import "../components/chartSetup";
import { apiClient, authHeaders } from "../api/client";
import StatCard from "../components/StatCard";
import SyncProgressModal from "../components/SyncProgressModal";
import { useAuth } from "../context/AuthContext";
import { buildLocationAnalysisScope, readSelectedAnalysisScope, writeSelectedAnalysisScope } from "../utils/analysisScope";
import { buildNdviMonthly, readGeometryScope } from "../utils/geometryAnalysis";
import { pickPreferredLocation, writeSelectedLocation } from "../utils/locationSelection";
import { getLocationCenter } from "../utils/mapGeometry";
import { toVietnameseLabel } from "../utils/viText";

const DEFAULT_LOCATION = { id: 1, name: "Quảng Trị", province: "Quảng Trị" };

function classifyNdvi(value) {
  const v = Number(value);
  if (v < 0) {
    return { level: "Nước/Không thực vật", desc: "Chỉ số NDVI âm, khu vực không có che phủ xanh." };
  }
  if (v < 0.1) {
    return { level: "Đất trống", desc: "Độ che phủ thấp, cần theo dõi xói mòn và suy thoái đất." };
  }
  if (v < 0.2) {
    return { level: "Thực vật thưa", desc: "Đang ở mức trung gian, nhạy cảm với khô hạn." };
  }
  if (v < 0.4) {
    return { level: "Thực vật vừa", desc: "Tình trạng thảm thực vật ổn định ở mức trung bình." };
  }
  if (v < 0.6) {
    return { level: "Thực vật dày", desc: "Sinh khối tốt, hệ sinh thái đang khỏe mạnh." };
  }
  return { level: "Thực vật rất dày", desc: "Độ che phủ xanh rất cao, cần ưu tiên bảo tồn." };
}

const ndviColors = ["#0571b0", "#ca0020", "#f4a582", "#92c5de", "#4dac26", "#1b7837"];

export default function NdviPage() {
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
    void logActivity("page_view", "ndvi");
  }, [logActivity]);

  useEffect(() => {
    const boot = async () => {
      try {
        const response = await apiClient.get("/locations");
        const next = response.data?.data || [];
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
    void boot();
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
      apiClient.get("/ndvi", {
        params: { location_id: locationId, start: form.startDate, end: form.endDate, source: "db", province }
      }),
      apiClient.get("/ndvi/monthly", {
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
          "/ndvi",
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
        setMonthlyData(buildNdviMonthly(rows));
        if (payload.analysis_scope?.history_id) {
          const nextScope = { ...geometryScope, historyId: payload.analysis_scope.history_id };
          setGeometryScope(nextScope);
          writeSelectedAnalysisScope(nextScope);
        }
        setStatus("Đã cập nhật kết quả NDVI theo vùng geometry tùy chọn.");
        setStatusType("ok");
        return;
      }

      const year = form.startDate.split("-")[0];
      const [daily, monthly] = await Promise.all([
        apiClient.get("/ndvi", {
          params: { location_id: form.locationId, start: form.startDate, end: form.endDate, source, province: form.province }
        }),
        apiClient.get("/ndvi/monthly", {
          params: { location_id: form.locationId, year, source, province: form.province }
        })
      ]);
      setDailyData(daily.data?.data?.data || []);
      setStats(daily.data?.data?.statistics || null);
      setMonthlyData(monthly.data?.data?.monthly_data || []);
      setStatus(source === "db" ? "Đã tải kết quả NDVI từ cơ sở dữ liệu." : "Đã cập nhật kết quả phân tích NDVI.");
      setStatusType("ok");
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Không tải được dữ liệu NDVI.");
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
              data_types: ["ndvi"]
            }
          : {
              province: form.province,
              location_id: Number(form.locationId),
              start_date: form.startDate,
              end_date: form.endDate,
              data_types: ["ndvi"]
            },
        { headers: authHeaders(token) }
      );
      const records = response.data?.data?.results?.ndvi?.records || 0;
      setStatus(`Đồng bộ thành công ${records} bản ghi NDVI.`);
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
    return classifyNdvi(stats.average);
  }, [stats]);

  const ndviLineData = {
    labels: dailyData.map((item) => item.date),
    datasets: [
      {
        label: "NDVI trung bình",
        data: dailyData.map((item) => Number(item.ndvi_mean || 0)),
        borderColor: "#00a676",
        backgroundColor: "rgba(0, 166, 118, 0.16)",
        fill: true,
        tension: 0.3
      }
    ]
  };

  const monthlyChartData = {
    labels: monthlyData.map((item) => `T${item.month}`),
    datasets: [
      {
        label: "NDVI TB",
        data: monthlyData.map((item) => Number(item.avg_ndvi || 0)),
        backgroundColor: monthlyData.map((item) => {
          const v = Number(item.avg_ndvi || 0);
          if (v < 0) return ndviColors[0];
          if (v < 0.1) return ndviColors[1];
          if (v < 0.2) return ndviColors[2];
          if (v < 0.4) return ndviColors[3];
          if (v < 0.6) return ndviColors[4];
          return ndviColors[5];
        })
      }
    ]
  };

  const classCounts = dailyData.reduce(
    (acc, item) => {
      const v = Number(item.ndvi_mean || 0);
      if (v < 0) acc[0] += 1;
      else if (v < 0.1) acc[1] += 1;
      else if (v < 0.2) acc[2] += 1;
      else if (v < 0.4) acc[3] += 1;
      else if (v < 0.6) acc[4] += 1;
      else acc[5] += 1;
      return acc;
    },
    [0, 0, 0, 0, 0, 0]
  );

  const classChartData = {
    labels: ["Nước", "Đất trống", "Thưa", "Vừa", "Dày", "Rất dày"],
    datasets: [{ data: classCounts, backgroundColor: ndviColors }]
  };

  return (
    <>
      <SyncProgressModal
        open={syncing}
        title="Đang tải dữ liệu NDVI từ GEE"
        description="Hệ thống đang kết nối Google Earth Engine, tính toán NDVI và đồng bộ kết quả về cơ sở dữ liệu."
      />
      <section className="card page-header">
        <h1>Phân tích NDVI</h1>
        <p>Đánh giá tình trạng thảm thực vật và độ che phủ xanh theo thời gian.</p>
      </section>

      {status && <div className={`status ${statusType}`}>{status}</div>}
      <div className={`status ${geeOnline ? "ok" : "warn"}`}>
        GEE Service: {geeOnline ? "Online" : "Offline"}
      </div>
      {usingGeometry ? (
        <div className="status ok">
          Đang phân tích theo vùng tùy chọn: <strong>{toVietnameseLabel(geometryScope.name)}</strong>. Dữ liệu NDVI đang được lấy trực tiếp từ GEE theo geometry đã chọn trên bản đồ.
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
        <StatCard label="NDVI trung bình" value={stats?.average ?? "--"} />
        <StatCard label="NDVI thấp nhất" value={stats?.min ?? "--"} />
        <StatCard label="NDVI cao nhất" value={stats?.max ?? "--"} />
        <StatCard label="Diện tích thảm thực vật (%)" value={stats?.avg_vegetation_pct ?? "--"} />
      </section>

      <section className="chart-grid">
        <div className="card chart-card">
          <h3>NDVI theo thời gian</h3>
          <Line data={ndviLineData} />
        </div>
      </section>

      <section className="chart-grid two">
        <div className="card chart-card">
          <h3>NDVI trung bình theo tháng</h3>
          <Bar data={monthlyChartData} />
        </div>
        <div className="card chart-card">
          <h3>Phân bố lớp NDVI</h3>
          <Doughnut data={classChartData} />
        </div>
      </section>
    </>
  );
}
