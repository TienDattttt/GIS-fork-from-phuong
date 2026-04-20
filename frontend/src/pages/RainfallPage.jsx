import { useEffect, useMemo, useState } from "react";
import { Bar, Doughnut, Line } from "react-chartjs-2";

import "../components/chartSetup";
import { apiClient, authHeaders } from "../api/client";
import StatCard from "../components/StatCard";
import SyncProgressModal from "../components/SyncProgressModal";
import { useAuth } from "../context/AuthContext";
import { buildLocationAnalysisScope, readSelectedAnalysisScope, writeSelectedAnalysisScope } from "../utils/analysisScope";
import { buildRainfallMonthly, readGeometryScope } from "../utils/geometryAnalysis";
import { pickPreferredLocation, writeSelectedLocation } from "../utils/locationSelection";
import { getLocationCenter } from "../utils/mapGeometry";
import { toVietnameseLabel } from "../utils/viText";

const DEFAULT_LOCATION = { id: 1, name: "Quảng Trị", province: "Quảng Trị" };

function classifyRainfall(value) {
  const v = Number(value);
  if (v < 2) {
    return { level: "Không mưa", desc: "Độ ẩm đất giảm nhanh. Nguy cơ khô hạn nếu kéo dài." };
  }
  if (v < 10) {
    return { level: "Mưa nhẹ", desc: "Giảm nhiệt tạm thời, nhưng chưa bổ sung nước đáng kể." };
  }
  if (v < 30) {
    return { level: "Mưa vừa", desc: "Điều kiện thuận lợi cho canh tác và phục hồi độ ẩm đất." };
  }
  if (v < 50) {
    return { level: "Mưa lớn", desc: "Cần theo dõi ngập cục bộ và xói mòn tại khu vực dốc." };
  }
  return { level: "Mưa rất lớn", desc: "Rủi ro cao về lũ quét, sạt lở và ngập úng." };
}

function toNumber(value) {
  return Number(value || 0);
}

export default function RainfallPage() {
  const { logActivity, token } = useAuth();
  const [geometryScope, setGeometryScope] = useState(() => readGeometryScope());
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({
    locationId: "1",
    province: "Quảng Trị",
    startDate: "2020-01-01",
    endDate: "2020-12-31"
  });
  const [periodForm, setPeriodForm] = useState({
    start1: "2020-01-01",
    end1: "2020-06-30",
    start2: "2020-07-01",
    end2: "2020-12-31"
  });
  const [locationCompareForm, setLocationCompareForm] = useState({
    location1: "1",
    location2: "1",
    start: "2020-01-01",
    end: "2020-12-31"
  });
  const [geeOnline, setGeeOnline] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("ok");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [monthlyData, setMonthlyData] = useState([]);
  const [periodComparison, setPeriodComparison] = useState(null);
  const [locationComparison, setLocationComparison] = useState(null);
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
    void logActivity("page_view", "rainfall");
  }, [logActivity]);

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const response = await apiClient.get("/locations");
        const next = response.data?.data || [];
        if (next.length > 0) {
          setLocations(next);
          const preferred = pickPreferredLocation(next, DEFAULT_LOCATION);
          const primary = String(preferred.id);
          const secondary = String((next[1] || next[0]).id);
          writeSelectedLocation(preferred);
          const scope = readSelectedAnalysisScope();
          setGeometryScope(scope?.mode === "geometry" && scope.geometry ? scope : null);
          setForm((prev) => ({
            ...prev,
            locationId: String(scope?.locationId || primary),
            province: toVietnameseLabel(scope?.province || preferred.province),
          }));
          setLocationCompareForm((prev) => ({
            ...prev,
            location1: primary,
            location2: secondary
          }));
        } else {
          setLocations([DEFAULT_LOCATION]);
          setStatus("Chưa có dữ liệu địa điểm trong CSDL, đang dùng địa điểm mặc định Quảng Trị.");
          setStatusType("warn");
        }
      } catch {
        setLocations([DEFAULT_LOCATION]);
        setStatus("Không tải được danh sách địa điểm, hệ thống dùng cấu hình mặc định.");
        setStatusType("warn");
      }
    };

    const checkGEEStatus = async () => {
      try {
        const response = await apiClient.get("/gee/status");
        const online = response.data?.data?.status === "online" && response.data?.data?.gee_initialized;
        setGeeOnline(Boolean(online));
      } catch {
        setGeeOnline(false);
      }
    };

    void loadLocations();
    void checkGEEStatus();
    const timer = window.setInterval(() => void checkGEEStatus(), 30000);
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
      apiClient.get("/rainfall", {
        params: { location_id: locationId, start: form.startDate, end: form.endDate, source: "db", province }
      }),
      apiClient.get("/rainfall/monthly", {
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
          "/rainfall",
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
        setMonthlyData(buildRainfallMonthly(rows));
        if (payload.analysis_scope?.history_id) {
          const nextScope = { ...geometryScope, historyId: payload.analysis_scope.history_id };
          setGeometryScope(nextScope);
          writeSelectedAnalysisScope(nextScope);
        }
        setStatus("Đã cập nhật kết quả lượng mưa theo vùng geometry tùy chọn.");
        setStatusType("ok");
        return;
      }

      const year = form.startDate.split("-")[0];
      const [daily, monthly] = await Promise.all([
        apiClient.get("/rainfall", {
          params: { location_id: form.locationId, start: form.startDate, end: form.endDate, source, province: form.province }
        }),
        apiClient.get("/rainfall/monthly", {
          params: { location_id: form.locationId, year, source, province: form.province }
        })
      ]);
      setDailyData(daily.data?.data?.data || []);
      setStats(daily.data?.data?.statistics || null);
      setMonthlyData(monthly.data?.data?.monthly_data || []);
      setStatus(source === "db" ? "Đã tải kết quả lượng mưa từ cơ sở dữ liệu." : "Đã cập nhật kết quả phân tích lượng mưa.");
      setStatusType("ok");
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Không tải được dữ liệu trong khoảng thời gian đã chọn.");
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
              data_types: ["rainfall"]
            }
          : {
              province: form.province,
              location_id: Number(form.locationId),
              start_date: form.startDate,
              end_date: form.endDate,
              data_types: ["rainfall"]
            },
        { headers: authHeaders(token) }
      );
      const records = response.data?.data?.results?.rainfall?.records || 0;
      setStatus(`Đồng bộ thành công ${records} bản ghi lượng mưa.`);
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

  const comparePeriods = async () => {
    setCompareLoading(true);
    try {
      const response = await apiClient.get("/rainfall/compare-periods", {
        params: { location_id: form.locationId, ...periodForm }
      });
      setPeriodComparison(response.data?.data || null);
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Không so sánh được 2 giai đoạn.");
      setStatusType("error");
    } finally {
      setCompareLoading(false);
    }
  };

  const compareLocations = async () => {
    setCompareLoading(true);
    try {
      const response = await apiClient.get("/rainfall/compare-locations", {
        params: locationCompareForm
      });
      setLocationComparison(response.data?.data || null);
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Không so sánh được 2 địa điểm.");
      setStatusType("error");
    } finally {
      setCompareLoading(false);
    }
  };

  const alertInfo = useMemo(() => {
    if (!stats) {
      return null;
    }
    return classifyRainfall(stats.average);
  }, [stats]);

  const lineData = {
    labels: dailyData.map((item) => item.date),
    datasets: [
      {
        label: "Lượng mưa (mm)",
        data: dailyData.map((item) => toNumber(item.rainfall_mm)),
        borderColor: "#0077b6",
        backgroundColor: "rgba(0, 119, 182, 0.15)",
        fill: true,
        tension: 0.3
      }
    ]
  };

  const monthlyChartData = {
    labels: monthlyData.map((item) => `T${item.month}`),
    datasets: [
      {
        label: "Tổng mưa (mm)",
        data: monthlyData.map((item) => toNumber(item.total)),
        backgroundColor: "#00a676"
      }
    ]
  };

  const distributionCounts = dailyData.reduce(
    (acc, item) => {
      const value = toNumber(item.rainfall_mm);
      if (value < 5) acc[0] += 1;
      else if (value < 10) acc[1] += 1;
      else if (value < 20) acc[2] += 1;
      else if (value < 50) acc[3] += 1;
      else acc[4] += 1;
      return acc;
    },
    [0, 0, 0, 0, 0]
  );

  const doughnutData = {
    labels: ["0-5", "5-10", "10-20", "20-50", ">50"],
    datasets: [{ data: distributionCounts, backgroundColor: ["#caf0f8", "#90e0ef", "#48cae4", "#00b4d8", "#0077b6"] }]
  };

  return (
    <div className="panel-stack">
      <SyncProgressModal
        open={syncing}
        title="Đang tải dữ liệu lượng mưa từ GEE"
        description="Hệ thống đang kết nối Google Earth Engine, lấy dữ liệu CHIRPS và đồng bộ vào cơ sở dữ liệu."
      />

      <section className="card page-header">
        <h1>Phân tích Lượng mưa</h1>
        <p>Dữ liệu CHIRPS và thống kê theo khoảng thời gian tùy chọn, kèm các công cụ so sánh nhanh.</p>
      </section>

      {status && <div className={`status ${statusType}`}>{status}</div>}
      <div className={`status ${geeOnline ? "ok" : "warn"}`}>GEE Service: {geeOnline ? "Online" : "Offline"}</div>
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
          <input type="date" value={form.startDate} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))} />
        </div>
        <div className="field">
          <label>Đến ngày</label>
          <input type="date" value={form.endDate} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} />
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={fetchFromGEE} disabled={loading || !geeOnline}>
            Tải từ GEE
          </button>
          <button type="button" className="btn btn-primary" onClick={() => loadData()} disabled={loading || !geeOnline}>
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
        <StatCard label="Tổng lượng mưa (mm)" value={stats?.total ?? "--"} />
        <StatCard label="Trung bình (mm/ngày)" value={stats?.average ?? "--"} />
        <StatCard label="Lớn nhất (mm)" value={stats?.max ?? "--"} />
        <StatCard label="Số ngày dữ liệu" value={stats?.days ?? "--"} />
      </section>

      <section className="chart-grid">
        <div className="card chart-card">
          <h3>Lượng mưa theo thời gian</h3>
          <Line data={lineData} />
        </div>
      </section>
      <section className="chart-grid two">
        <div className="card chart-card">
          <h3>Tổng lượng mưa theo tháng</h3>
          <Bar data={monthlyChartData} />
        </div>
        <div className="card chart-card">
          <h3>Phân bố lượng mưa</h3>
          <Doughnut data={doughnutData} />
        </div>
      </section>

      {usingGeometry ? (
        <section className="card table-card">
          <h3>So sánh nâng cao</h3>
          <p className="empty-note">
            Các công cụ so sánh 2 giai đoạn và 2 địa điểm hiện vẫn bám theo địa điểm trong CSDL. Khi cần, bạn có thể quay về
            chế độ chọn địa điểm để dùng các bảng so sánh này.
          </p>
        </section>
      ) : (
      <section className="split-grid">
        <div className="card table-card">
          <h3>So sánh 2 giai đoạn</h3>
          <div className="subgrid" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>Bắt đầu giai đoạn 1</label>
              <input type="date" value={periodForm.start1} onChange={(e) => setPeriodForm((prev) => ({ ...prev, start1: e.target.value }))} />
            </div>
            <div className="field">
              <label>Kết thúc giai đoạn 1</label>
              <input type="date" value={periodForm.end1} onChange={(e) => setPeriodForm((prev) => ({ ...prev, end1: e.target.value }))} />
            </div>
            <div className="field">
              <label>Bắt đầu giai đoạn 2</label>
              <input type="date" value={periodForm.start2} onChange={(e) => setPeriodForm((prev) => ({ ...prev, start2: e.target.value }))} />
            </div>
            <div className="field">
              <label>Kết thúc giai đoạn 2</label>
              <input type="date" value={periodForm.end2} onChange={(e) => setPeriodForm((prev) => ({ ...prev, end2: e.target.value }))} />
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={comparePeriods} disabled={compareLoading}>
            {compareLoading ? "Đang so sánh..." : "So sánh giai đoạn"}
          </button>
          {periodComparison ? (
            <div className="subgrid" style={{ marginTop: 14 }}>
              <StatCard label="Tổng mưa giai đoạn 1" value={periodComparison.period_1?.total ?? "--"} />
              <StatCard label="Tổng mưa giai đoạn 2" value={periodComparison.period_2?.total ?? "--"} />
              <StatCard label="Chênh lệch" value={periodComparison.comparison?.difference ?? "--"} />
              <StatCard label="Biến động (%)" value={periodComparison.comparison?.percentage_change ?? "--"} />
            </div>
          ) : (
            <p className="empty-note" style={{ marginTop: 14 }}>Chưa có kết quả so sánh giai đoạn.</p>
          )}
        </div>

        <div className="card table-card">
          <h3>So sánh 2 địa điểm</h3>
          <div className="subgrid" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>Địa điểm 1</label>
              <select
                value={locationCompareForm.location1}
                onChange={(e) => setLocationCompareForm((prev) => ({ ...prev, location1: e.target.value }))}
              >
                {locationOptions.map((location) => (
                  <option key={`compare-1-${location.id}`} value={location.id}>
                    {toVietnameseLabel(location.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Địa điểm 2</label>
              <select
                value={locationCompareForm.location2}
                onChange={(e) => setLocationCompareForm((prev) => ({ ...prev, location2: e.target.value }))}
              >
                {locationOptions.map((location) => (
                  <option key={`compare-2-${location.id}`} value={location.id}>
                    {toVietnameseLabel(location.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Từ ngày</label>
              <input type="date" value={locationCompareForm.start} onChange={(e) => setLocationCompareForm((prev) => ({ ...prev, start: e.target.value }))} />
            </div>
            <div className="field">
              <label>Đến ngày</label>
              <input type="date" value={locationCompareForm.end} onChange={(e) => setLocationCompareForm((prev) => ({ ...prev, end: e.target.value }))} />
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={compareLocations} disabled={compareLoading}>
            {compareLoading ? "Đang so sánh..." : "So sánh địa điểm"}
          </button>
          {locationComparison ? (
            <div className="subgrid" style={{ marginTop: 14 }}>
              <StatCard label="Tổng mưa địa điểm 1" value={locationComparison.location_1?.total ?? "--"} />
              <StatCard label="Tổng mưa địa điểm 2" value={locationComparison.location_2?.total ?? "--"} />
              <StatCard label="TB địa điểm 1" value={locationComparison.location_1?.average ?? "--"} />
              <StatCard label="TB địa điểm 2" value={locationComparison.location_2?.average ?? "--"} />
            </div>
          ) : (
            <p className="empty-note" style={{ marginTop: 14 }}>Chưa có kết quả so sánh địa điểm.</p>
          )}
        </div>
      </section>
      )}
    </div>
  );
}
