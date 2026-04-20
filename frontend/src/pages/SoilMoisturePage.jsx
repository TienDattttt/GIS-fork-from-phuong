import { useEffect, useMemo, useState } from "react";
import { Bar, Line } from "react-chartjs-2";

import "../components/chartSetup";
import { apiClient } from "../api/client";
import StatCard from "../components/StatCard";
import SyncProgressModal from "../components/SyncProgressModal";
import { useAuth } from "../context/AuthContext";
import { pickPreferredLocation, writeSelectedLocation } from "../utils/locationSelection";
import { getLocationCenter } from "../utils/mapGeometry";
import { toVietnameseLabel } from "../utils/viText";

const DEFAULT_LOCATION = { id: 1, name: "Quảng Trị", province: "Quảng Trị" };

function classifySoilMoisture(value) {
  const v = Number(value);
  if (v < 0.1) {
    return { level: "Khô", desc: "Độ ẩm thấp, cây trồng dễ chịu stress nước." };
  }
  if (v < 0.2) {
    return { level: "Thấp", desc: "Nguồn ẩm đang giảm, cần theo dõi tưới bổ sung." };
  }
  if (v < 0.3) {
    return { level: "Ổn định", desc: "Độ ẩm đất đang ở mức phù hợp cho canh tác." };
  }
  return { level: "Ẩm cao", desc: "Độ ẩm dồi dào, cần theo dõi nguy cơ úng nếu kéo dài." };
}

export default function SoilMoisturePage() {
  const { logActivity } = useAuth();
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
  const selectedLocationCoordinates = useMemo(() => {
    const target = locationOptions.find((item) => String(item.id) === String(form.locationId));
    if (!target) {
      return null;
    }
    const [lat, lon] = getLocationCenter(target);
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
      return null;
    }
    return { lat: Number(lat), lon: Number(lon) };
  }, [form.locationId, locationOptions]);

  useEffect(() => {
    void logActivity("page_view", "soil_moisture");
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
          setForm((prev) => ({
            ...prev,
            locationId: String(preferred.id),
            province: toVietnameseLabel(preferred.province)
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

  const loadData = async (source = "gee") => {
    setLoading(true);
    setStatus("");
    try {
      const year = form.startDate.split("-")[0];
      const [daily, monthly] = await Promise.all([
        apiClient.get("/soil-moisture", {
          params: { location_id: form.locationId, start: form.startDate, end: form.endDate, source, province: form.province }
        }),
        apiClient.get("/soil-moisture/monthly", {
          params: { location_id: form.locationId, year, source, province: form.province }
        })
      ]);

      setDailyData(daily.data?.data?.data || []);
      setStats(daily.data?.data?.statistics || null);
      setMonthlyData(monthly.data?.data?.monthly_data || []);
      setStatus(source === "db" ? "Đã tải kết quả độ ẩm đất từ cơ sở dữ liệu." : "Đã cập nhật kết quả phân tích độ ẩm đất.");
      setStatusType("ok");
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Không tải được dữ liệu độ ẩm đất.");
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
      const response = await apiClient.post("/gee/fetch", {
        province: form.province,
        location_id: Number(form.locationId),
        start_date: form.startDate,
        end_date: form.endDate,
        data_types: ["soil_moisture"]
      });
      const records = response.data?.data?.results?.soil_moisture?.records || 0;
      setStatus(`Đồng bộ thành công ${records} bản ghi độ ẩm đất.`);
      setStatusType("ok");
      await loadData("db");
    } catch (err) {
      setStatus(err.response?.data?.error?.message || "Đồng bộ GEE thất bại.");
      setStatusType("error");
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  };

  const alertInfo = useMemo(() => classifySoilMoisture(stats?.avg_surface || 0), [stats]);

  const dailyChartData = {
    labels: dailyData.map((item) => item.date),
    datasets: [
      {
        label: "Bề mặt",
        data: dailyData.map((item) => Number(item.sm_surface || 0)),
        borderColor: "#00a676",
        backgroundColor: "rgba(0, 166, 118, 0.12)",
        fill: true,
        tension: 0.3
      },
      {
        label: "Tầng rễ",
        data: dailyData.map((item) => Number(item.sm_rootzone || 0)),
        borderColor: "#0077b6",
        tension: 0.3
      },
      {
        label: "Toàn hồ sơ",
        data: dailyData.map((item) => Number(item.sm_profile || 0)),
        borderColor: "#f57c00",
        tension: 0.3
      }
    ]
  };

  const monthlyChartData = {
    labels: monthlyData.map((item) => `T${item.month}`),
    datasets: [
      {
        label: "Bề mặt",
        data: monthlyData.map((item) => Number(item.avg_surface || 0)),
        backgroundColor: "#00a676"
      },
      {
        label: "Tầng rễ",
        data: monthlyData.map((item) => Number(item.avg_rootzone || 0)),
        backgroundColor: "#0077b6"
      },
      {
        label: "Toàn hồ sơ",
        data: monthlyData.map((item) => Number(item.avg_profile || 0)),
        backgroundColor: "#f57c00"
      }
    ]
  };

  return (
    <div className="panel-stack">
      <SyncProgressModal
        open={syncing}
        title="Đang tải dữ liệu độ ẩm đất từ GEE"
        description="Hệ thống đang kết nối Google Earth Engine, lấy dữ liệu độ ẩm đất và đồng bộ vào cơ sở dữ liệu."
      />

      <section className="card page-header">
        <h1>Phân tích Độ ẩm đất</h1>
        <p>Theo dõi độ ẩm bề mặt, tầng rễ và toàn hồ sơ đất theo thời gian.</p>
      </section>

      {status && <div className={`status ${statusType}`}>{status}</div>}
      <div className={`status ${geeOnline ? "ok" : "warn"}`}>GEE Service: {geeOnline ? "Online" : "Offline"}</div>

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
                writeSelectedLocation(loc);
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

      {stats && (
        <section className="alert-banner">
          <h3>{alertInfo.level}</h3>
          <p style={{ margin: 0 }}>{alertInfo.desc}</p>
        </section>
      )}

      <section className="grid-4">
        <StatCard label="TB bề mặt" value={stats?.avg_surface ?? "--"} />
        <StatCard label="TB tầng rễ" value={stats?.avg_rootzone ?? "--"} />
        <StatCard label="TB toàn hồ sơ" value={stats?.avg_profile ?? "--"} />
        <StatCard label="Số ngày dữ liệu" value={stats?.days ?? "--"} />
      </section>

      <section className="chart-grid">
        <div className="card chart-card">
          <h3>Độ ẩm đất theo thời gian</h3>
          <Line data={dailyChartData} />
        </div>
      </section>

      <section className="chart-grid">
        <div className="card chart-card">
          <h3>Độ ẩm đất trung bình theo tháng</h3>
          <Bar data={monthlyChartData} />
        </div>
      </section>
    </div>
  );
}
