import { useEffect, useMemo, useState } from "react";
import { Bar, Doughnut, Line } from "react-chartjs-2";

import "../components/chartSetup";
import { apiClient, authHeaders } from "../api/client";
import StatCard from "../components/StatCard";
import SyncProgressModal from "../components/SyncProgressModal";
import { useAuth } from "../context/AuthContext";
import { buildLocationAnalysisScope, readSelectedAnalysisScope, writeSelectedAnalysisScope } from "../utils/analysisScope";
import {
  buildTvdiDroughtSummary,
  buildTvdiMonthly,
  buildTvdiSevereEvents,
  finalizeTvdiDroughtSummary,
  readGeometryScope,
} from "../utils/geometryAnalysis";
import { pickPreferredLocation, writeSelectedLocation } from "../utils/locationSelection";
import { getLocationCenter } from "../utils/mapGeometry";
import { toVietnameseLabel } from "../utils/viText";

const DEFAULT_LOCATION = { id: 1, name: "Quảng Trị", province: "Quảng Trị" };
const droughtColors = ["#2166ac", "#67a9cf", "#fddbc7", "#ef8a62", "#b2182b"];

function classifyTvdi(value) {
  const v = Number(value);
  if (v < 0.2) {
    return { level: "Ẩm ướt", desc: "Không có dấu hiệu hạn hán đáng kể." };
  }
  if (v < 0.4) {
    return { level: "Bình thường", desc: "Điều kiện độ ẩm và nhiệt độ ổn định." };
  }
  if (v < 0.6) {
    return { level: "Hạn nhẹ", desc: "Cần tăng cường theo dõi nguồn nước tưới." };
  }
  if (v < 0.8) {
    return { level: "Hạn nặng", desc: "Nguy cơ giảm năng suất và cháy rừng tăng cao." };
  }
  return { level: "Hạn cực đoan", desc: "Tình huống khẩn cấp, cần kích hoạt phương án ứng phó." };
}

function classificationChip(type) {
  if (type === "extreme") {
    return "chip danger";
  }
  if (type === "severe") {
    return "chip warn";
  }
  return "chip";
}

export default function TvdiPage() {
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
  const [droughtSummary, setDroughtSummary] = useState({});
  const [severeEvents, setSevereEvents] = useState([]);
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
    void logActivity("page_view", "tvdi");
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
          setStatus("Chưa có dữ liệu địa điểm trong CSDL, đang dùng địa điểm mặc định Quảng Trị.");
          setStatusType("warn");
        }
      } catch {
        setLocations([DEFAULT_LOCATION]);
        setStatus("Không tải được danh sách địa điểm.");
        setStatusType("warn");
      }
    };

    const check = async () => {
      try {
        const response = await apiClient.get("/gee/status");
        const online = response.data?.data?.status === "online" && response.data?.data?.gee_initialized;
        setGeeOnline(Boolean(online));
      } catch {
        setGeeOnline(false);
      }
    };

    void boot();
    void check();
    const timer = window.setInterval(() => void check(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const loadAdvancedData = async () => {
    try {
      const startYear = form.startDate.slice(0, 4);
      const endYear = form.endDate.slice(0, 4);
      const [summaryResponse, severeResponse] = await Promise.all([
        apiClient.get("/tvdi/drought-summary", {
          params: { location_id: form.locationId, start_year: startYear, end_year: endYear }
        }),
        apiClient.get("/tvdi/severe-events", {
          params: { location_id: form.locationId, start: form.startDate, end: form.endDate }
        })
      ]);
      setDroughtSummary(summaryResponse.data?.data?.drought_summary || {});
      setSevereEvents(severeResponse.data?.data?.severe_events || []);
    } catch {
      setDroughtSummary({});
      setSevereEvents([]);
    }
  };

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
      apiClient.get("/tvdi", {
        params: { location_id: locationId, start: form.startDate, end: form.endDate, source: "db", province }
      }),
      apiClient.get("/tvdi/monthly", {
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
          "/tvdi",
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
        setMonthlyData(buildTvdiMonthly(rows));
        setDroughtSummary(finalizeTvdiDroughtSummary(buildTvdiDroughtSummary(rows)));
        setSevereEvents(buildTvdiSevereEvents(rows));
        if (payload.analysis_scope?.history_id) {
          const nextScope = { ...geometryScope, historyId: payload.analysis_scope.history_id };
          setGeometryScope(nextScope);
          writeSelectedAnalysisScope(nextScope);
        }
        setStatus("Đã cập nhật kết quả TVDI theo vùng geometry tùy chọn.");
        setStatusType("ok");
        return;
      }

      const year = form.startDate.split("-")[0];
      const [daily, monthly] = await Promise.all([
        apiClient.get("/tvdi", {
          params: { location_id: form.locationId, start: form.startDate, end: form.endDate, source, province: form.province }
        }),
        apiClient.get("/tvdi/monthly", {
          params: { location_id: form.locationId, year, source, province: form.province }
        })
      ]);
      setDailyData(daily.data?.data?.data || []);
      setStats(daily.data?.data?.statistics || null);
      setMonthlyData(monthly.data?.data?.monthly_data || []);
      await loadAdvancedData();
      setStatus(source === "db" ? "Đã tải kết quả TVDI từ cơ sở dữ liệu." : "Đã cập nhật kết quả phân tích TVDI.");
      setStatusType("ok");
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Không tải được dữ liệu TVDI.");
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
              data_types: ["tvdi"]
            }
          : {
              province: form.province,
              location_id: Number(form.locationId),
              start_date: form.startDate,
              end_date: form.endDate,
              data_types: ["tvdi"]
            },
        { headers: authHeaders(token) }
      );
      const records = response.data?.data?.results?.tvdi?.records || 0;
      setStatus(`Đồng bộ thành công ${records} bản ghi TVDI.`);
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
    return classifyTvdi(stats.average);
  }, [stats]);

  const tvdiLineData = {
    labels: dailyData.map((item) => item.date),
    datasets: [
      {
        label: "TVDI trung bình",
        data: dailyData.map((item) => Number(item.tvdi_mean || 0)),
        borderColor: "#ef8a62",
        backgroundColor: "rgba(239, 138, 98, 0.15)",
        fill: true,
        tension: 0.3
      }
    ]
  };

  const monthlyChartData = {
    labels: monthlyData.map((item) => `T${item.month}`),
    datasets: [
      {
        label: "TVDI TB",
        data: monthlyData.map((item) => Number(item.avg_tvdi || 0)),
        backgroundColor: monthlyData.map((item) => {
          const v = Number(item.avg_tvdi || 0);
          if (v < 0.2) return droughtColors[0];
          if (v < 0.4) return droughtColors[1];
          if (v < 0.6) return droughtColors[2];
          if (v < 0.8) return droughtColors[3];
          return droughtColors[4];
        })
      }
    ]
  };

  const classCounts = dailyData.reduce(
    (acc, item) => {
      const v = Number(item.tvdi_mean || 0);
      if (v < 0.2) acc[0] += 1;
      else if (v < 0.4) acc[1] += 1;
      else if (v < 0.6) acc[2] += 1;
      else if (v < 0.8) acc[3] += 1;
      else acc[4] += 1;
      return acc;
    },
    [0, 0, 0, 0, 0]
  );

  const classChartData = {
    labels: ["Ẩm ướt", "Bình thường", "Hạn nhẹ", "Hạn nặng", "Hạn cực đoan"],
    datasets: [{ data: classCounts, backgroundColor: droughtColors }]
  };

  const droughtRows = Object.entries(droughtSummary || {});

  return (
    <div className="panel-stack">
      <SyncProgressModal
        open={syncing}
        title="Đang tải dữ liệu TVDI từ GEE"
        description="Hệ thống đang kết nối Google Earth Engine, xử lý LST, NDVI và tính toán TVDI trước khi đồng bộ."
      />

      <section className="card page-header">
        <h1>Phân tích TVDI</h1>
        <p>Đánh giá tình trạng hạn hán qua TVDI, LST và các đợt khô hạn nghiêm trọng.</p>
      </section>

      {status && <div className={`status ${statusType}`}>{status}</div>}
      <div className={`status ${geeOnline ? "ok" : "warn"}`}>GEE Service: {geeOnline ? "Online" : "Offline"}</div>
      {usingGeometry ? (
        <div className="status ok">
          Đang phân tích theo vùng tùy chọn: <strong>{toVietnameseLabel(geometryScope.name)}</strong>. TVDI sẽ được tính trực tiếp trên geometry đã chọn thay vì chỉ theo location trong CSDL.
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
        <StatCard label="TVDI trung bình" value={stats?.average ?? "--"} />
        <StatCard label="LST trung bình (°C)" value={stats?.avg_lst ?? "--"} />
        <StatCard label="Tỷ lệ hạn (%)" value={stats?.drought_pct ?? "--"} />
        <StatCard label="Ngày hạn nặng" value={stats?.drought_days ?? "--"} />
      </section>

      <section className="chart-grid">
        <div className="card chart-card">
          <h3>TVDI theo thời gian</h3>
          <Line data={tvdiLineData} />
        </div>
      </section>

      <section className="chart-grid two">
        <div className="card chart-card">
          <h3>TVDI trung bình theo tháng</h3>
          <Bar data={monthlyChartData} />
        </div>
        <div className="card chart-card">
          <h3>Phân loại hạn hán</h3>
          <Doughnut data={classChartData} />
        </div>
      </section>

      <section className="split-grid">
        <div className="card table-card">
          <h3>Tổng hợp hạn hán theo năm</h3>
          {droughtRows.length === 0 ? (
            <p className="empty-note">Chưa có dữ liệu tổng hợp hạn hán trong cơ sở dữ liệu cho khoảng năm đã chọn.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Năm</th>
                  <th>Nhóm hạn</th>
                  <th>Số ngày</th>
                  <th>TVDI trung bình</th>
                </tr>
              </thead>
              <tbody>
                {droughtRows.flatMap(([year, values]) =>
                  Object.entries(values || {}).map(([classification, payload]) => (
                    <tr key={`${year}-${classification}`}>
                      <td>{year}</td>
                      <td>
                        <span className={classificationChip(classification)}>{classification}</span>
                      </td>
                      <td>{payload.count}</td>
                      <td>{payload.avg_tvdi}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="card table-card">
          <h3>Đợt hạn nghiêm trọng gần nhất</h3>
          {severeEvents.length === 0 ? (
            <p className="empty-note">Chưa ghi nhận đợt hạn nặng hoặc cực đoan trong khoảng thời gian đã chọn.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>TVDI</th>
                  <th>LST (°C)</th>
                  <th>Tỷ lệ hạn (%)</th>
                  <th>Mức</th>
                </tr>
              </thead>
              <tbody>
                {severeEvents.map((event) => (
                  <tr key={`${event.date}-${event.classification}`}>
                    <td>{String(event.date).slice(0, 10)}</td>
                    <td>{event.tvdi}</td>
                    <td>{event.lst}</td>
                    <td>{event.drought_pct}</td>
                    <td>
                      <span className={classificationChip(event.classification)}>{event.classification}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
