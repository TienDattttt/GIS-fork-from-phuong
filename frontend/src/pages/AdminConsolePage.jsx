import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CloudCog,
  Database,
  Eye,
  LogOut,
  MapPinned,
  Pencil,
  Plus,
  RadioTower,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { apiClient, authHeaders } from "../api/client";
import { useAuth } from "../context/AuthContext";

const SECTION_ITEMS = [
  { id: "overview", label: "Tổng quan", icon: ShieldCheck },
  { id: "users", label: "Người dùng", icon: Users },
  { id: "stations", label: "Trạm quan trắc", icon: RadioTower },
  { id: "manual", label: "Nhập liệu thủ công", icon: Database },
  { id: "locations", label: "Địa điểm", icon: MapPinned },
  { id: "gee", label: "Đồng bộ GEE", icon: CloudCog },
  { id: "activity", label: "Nhật ký hệ thống", icon: Activity },
];

const USER_FORM_DEFAULT = {
  id: null,
  fullName: "",
  role: "user",
  isActive: true,
};

const STATION_FORM_DEFAULT = {
  id: null,
  name: "",
  stationType: "water",
  lat: "",
  lon: "",
  rainfallMm: "",
  address: "",
  sourceDescription: "",
};

const MANUAL_FORM_DEFAULT = {
  id: null,
  dataType: "rainfall",
  locationId: "",
  useManualPoint: false,
  lat: "",
  lon: "",
  date: "2020-01-01",
  value: "",
  notes: "",
  sourceStationId: "",
};

const LOCATION_FORM_DEFAULT = {
  id: null,
  name: "",
  province: "",
  geometryText: "",
};

const GEE_SYNC_DEFAULT = {
  locationId: "",
  startDate: "2020-01-01",
  endDate: "2020-12-31",
  dataTypes: ["rainfall"],
};

const DATA_TYPE_OPTIONS = [
  { value: "rainfall", label: "Lượng mưa", unit: "mm" },
  { value: "temperature", label: "Nhiệt độ", unit: "°C" },
  { value: "soil_moisture", label: "Độ ẩm đất", unit: "m³/m³" },
  { value: "ndvi", label: "NDVI", unit: "NDVI" },
];

const SECTION_COPY = {
  overview: "Theo dõi nhanh sức khỏe vận hành của hệ WebGIS khí hậu.",
  users: "Quản trị người dùng, quyền truy cập và trạng thái tài khoản.",
  stations: "Quản lý master data trạm quan trắc phục vụ phân tích GIS và IDW.",
  manual: "Rà soát và chỉnh sửa nguồn dữ liệu do con người nhập vào hệ thống.",
  locations: "Quản trị location lõi, geometry và các thực thể gắn với dashboard.",
  gee: "Giám sát và kích hoạt đồng bộ dữ liệu khí hậu từ Google Earth Engine.",
  activity: "Theo dõi lịch sử vận hành, activity log và dấu vết thao tác quản trị.",
};

function extractErrorMessage(error, fallback) {
  return error?.response?.data?.error?.message || fallback;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toFixed(digits);
}

function stringifyDetails(details) {
  if (!details) {
    return "-";
  }
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function parseGeometryText(geometryText) {
  const trimmed = geometryText.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("Geometry JSON không hợp lệ.");
  }
}

function AdminModal({ open, title, subtitle, onClose, children, actions, wide = false }) {
  if (!open) {
    return null;
  }

  return (
    <div className="admin-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`card admin-modal ${wide ? "admin-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-modal__header">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="Đóng popup">
            <X size={18} />
          </button>
        </div>
        <div className="admin-modal__body">{children}</div>
        {actions ? <div className="admin-modal__footer">{actions}</div> : null}
      </div>
    </div>
  );
}

function IconActionButton({ title, variant = "default", onClick, children }) {
  return (
    <button type="button" className={`admin-icon-btn ${variant !== "default" ? `is-${variant}` : ""}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function SectionToolbar({ title, description, children, action }) {
  return (
    <div className="admin-toolbar">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="admin-toolbar__actions">
        {children}
        {action}
      </div>
    </div>
  );
}

function DetailGrid({ items }) {
  return (
    <div className="admin-detail-grid">
      {items.map((item) => (
        <div key={item.label} className="admin-detail-grid__item">
          <span>{item.label}</span>
          <strong>{item.value ?? "-"}</strong>
        </div>
      ))}
    </div>
  );
}

export default function AdminConsolePage() {
  const navigate = useNavigate();
  const { token, user, logout, logActivity } = useAuth();
  const [activeSection, setActiveSection] = useState("overview");
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState({ type: "ok", message: "" });
  const [modal, setModal] = useState({ type: null, payload: null });

  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [stations, setStations] = useState([]);
  const [manualEntries, setManualEntries] = useState([]);
  const [locations, setLocations] = useState([]);
  const [geeStatus, setGeeStatus] = useState(null);
  const [activityRows, setActivityRows] = useState([]);
  const [geeResult, setGeeResult] = useState(null);

  const [userFilters, setUserFilters] = useState({ q: "", role: "", status: "" });
  const [manualFilters, setManualFilters] = useState({ dataType: "", locationId: "", limit: "40" });
  const [activityFilters, setActivityFilters] = useState({ q: "", activityType: "", userId: "", limit: "60" });

  const [userForm, setUserForm] = useState(USER_FORM_DEFAULT);
  const [stationForm, setStationForm] = useState(STATION_FORM_DEFAULT);
  const [manualForm, setManualForm] = useState(MANUAL_FORM_DEFAULT);
  const [locationForm, setLocationForm] = useState(LOCATION_FORM_DEFAULT);
  const [geeSyncForm, setGeeSyncForm] = useState(GEE_SYNC_DEFAULT);

  const requestHeaders = useMemo(() => authHeaders(token), [token]);

  const sectionBadges = useMemo(
    () => ({
      overview: null,
      users: overview?.stats?.users_total ?? users.length,
      stations: overview?.stats?.stations_total ?? stations.length,
      manual: overview?.stats?.manual_entries_total ?? manualEntries.length,
      locations: overview?.stats?.locations_total ?? locations.length,
      gee: geeStatus?.status === "online" ? "Online" : "Offline",
      activity: overview?.stats?.recent_activity_7d ?? activityRows.length,
    }),
    [activityRows.length, geeStatus?.status, locations.length, manualEntries.length, overview, stations.length, users.length]
  );

  async function adminGet(path, params = {}) {
    const response = await apiClient.get(path, {
      headers: requestHeaders,
      params,
    });
    return response.data?.data;
  }

  async function loadOverview() {
    const data = await adminGet("/admin/overview");
    setOverview(data);
  }

  async function loadUsers() {
    const data = await adminGet("/admin/users", {
      ...userFilters,
      limit: 200,
    });
    setUsers(data || []);
  }

  async function loadStations() {
    const data = await adminGet("/admin/stations");
    setStations(data || []);
  }

  async function loadManualEntries() {
    const data = await adminGet("/admin/manual-entries", {
      data_type: manualFilters.dataType || undefined,
      location_id: manualFilters.locationId || undefined,
      limit: manualFilters.limit || undefined,
    });
    setManualEntries(data || []);
  }

  async function loadLocations() {
    const data = await adminGet("/admin/locations");
    setLocations(data || []);
  }

  async function loadGeeStatus() {
    const data = await adminGet("/admin/gee/status");
    setGeeStatus(data || null);
  }

  async function loadActivity() {
    const data = await adminGet("/admin/activity", {
      q: activityFilters.q || undefined,
      activity_type: activityFilters.activityType || undefined,
      user_id: activityFilters.userId || undefined,
      limit: activityFilters.limit || 60,
    });
    setActivityRows(data || []);
  }

  async function bootstrapAdminConsole() {
    setBooting(true);
    const results = await Promise.allSettled([
      loadOverview(),
      loadUsers(),
      loadStations(),
      loadManualEntries(),
      loadLocations(),
      loadGeeStatus(),
      loadActivity(),
    ]);
    const hasError = results.some((result) => result.status === "rejected");
    if (hasError) {
      setBanner({
        type: "warn",
        message: "Một vài khối quản trị chưa tải trọn vẹn. Bạn vẫn có thể tiếp tục thao tác ở các phần còn lại.",
      });
    }
    setBooting(false);
  }

  useEffect(() => {
    void logActivity("page_view", "admin-console");
  }, [logActivity]);

  useEffect(() => {
    void bootstrapAdminConsole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showBanner(type, message) {
    setBanner({ type, message });
  }

  function closeModal() {
    setModal({ type: null, payload: null });
  }

  async function refreshSection(sectionId = activeSection) {
    setRefreshing(true);
    try {
      if (sectionId === "overview") {
        await Promise.all([loadOverview(), loadGeeStatus()]);
      } else if (sectionId === "users") {
        await loadUsers();
      } else if (sectionId === "stations") {
        await loadStations();
      } else if (sectionId === "manual") {
        await loadManualEntries();
      } else if (sectionId === "locations") {
        await loadLocations();
      } else if (sectionId === "gee") {
        await Promise.all([loadGeeStatus(), loadLocations()]);
      } else if (sectionId === "activity") {
        await loadActivity();
      }
      showBanner("ok", "Đã làm mới dữ liệu quản trị.");
    } catch (error) {
      showBanner("error", extractErrorMessage(error, "Không thể làm mới dữ liệu quản trị."));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function openUserDetails(targetUser) {
    setModal({ type: "user-detail", payload: targetUser });
  }

  function openUserEdit(targetUser) {
    setUserForm({
      id: targetUser.id,
      fullName: targetUser.full_name || "",
      role: targetUser.role || "user",
      isActive: Boolean(targetUser.is_active),
    });
    setModal({ type: "user-edit", payload: targetUser });
  }

  async function saveUser() {
    if (!userForm.id) {
      showBanner("warn", "Hãy chọn một người dùng để cập nhật.");
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.put(
        `/admin/users/${userForm.id}`,
        {
          full_name: userForm.fullName,
          role: userForm.role,
          is_active: userForm.isActive,
        },
        { headers: requestHeaders }
      );
      await Promise.all([loadUsers(), loadOverview()]);
      showBanner("ok", "Đã cập nhật thông tin người dùng.");
      closeModal();
      setUserForm(USER_FORM_DEFAULT);
    } catch (error) {
      showBanner("error", extractErrorMessage(error, "Không cập nhật được người dùng."));
    } finally {
      setSubmitting(false);
    }
  }

  function openStationCreate() {
    setStationForm(STATION_FORM_DEFAULT);
    setModal({ type: "station-form", payload: null });
  }

  function openStationDetails(station) {
    setModal({ type: "station-detail", payload: station });
  }

  function openStationEdit(station) {
    setStationForm({
      id: station.id,
      name: station.name || "",
      stationType: station.station_type || "water",
      lat: station.lat ?? "",
      lon: station.lon ?? "",
      rainfallMm: station.rainfall_mm ?? "",
      address: station.address || "",
      sourceDescription: station.source_description || "",
    });
    setModal({ type: "station-form", payload: station });
  }

  async function saveStation(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name: stationForm.name,
        station_type: stationForm.stationType,
        lat: Number(stationForm.lat),
        lon: Number(stationForm.lon),
        rainfall_mm: stationForm.rainfallMm === "" ? null : Number(stationForm.rainfallMm),
        address: stationForm.address || null,
        source_description: stationForm.sourceDescription || null,
      };
      if (stationForm.id) {
        await apiClient.put(`/admin/stations/${stationForm.id}`, payload, { headers: requestHeaders });
      } else {
        await apiClient.post("/admin/stations", payload, { headers: requestHeaders });
      }
      await Promise.all([loadStations(), loadOverview()]);
      showBanner("ok", stationForm.id ? "Đã cập nhật trạm quan trắc." : "Đã tạo mới trạm quan trắc.");
      closeModal();
      setStationForm(STATION_FORM_DEFAULT);
    } catch (error) {
      showBanner("error", extractErrorMessage(error, "Không lưu được trạm quan trắc."));
    } finally {
      setSubmitting(false);
    }
  }

  function confirmStationDelete(station) {
    setModal({ type: "station-delete", payload: station });
  }

  async function removeStation(stationId) {
    setSubmitting(true);
    try {
      await apiClient.delete(`/admin/stations/${stationId}`, { headers: requestHeaders });
      await Promise.all([loadStations(), loadOverview()]);
      showBanner("ok", "Đã xóa trạm quan trắc.");
      closeModal();
    } catch (error) {
      showBanner("error", extractErrorMessage(error, "Không xóa được trạm quan trắc."));
    } finally {
      setSubmitting(false);
    }
  }

  function openManualCreate() {
    setManualForm(MANUAL_FORM_DEFAULT);
    setModal({ type: "manual-form", payload: null });
  }

  function openManualDetails(entry) {
    setModal({ type: "manual-detail", payload: entry });
  }

  function openManualEdit(entry) {
    setManualForm({
      id: entry.id,
      dataType: entry.data_type,
      locationId: entry.location_id ? String(entry.location_id) : "",
      useManualPoint: false,
      lat: "",
      lon: "",
      date: entry.date,
      value: entry.value ?? "",
      notes: entry.notes || "",
      sourceStationId: entry.source_station_id ? String(entry.source_station_id) : "",
    });
    setModal({ type: "manual-form", payload: entry });
  }

  async function saveManualEntry(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        data_type: manualForm.dataType,
        date: manualForm.date,
        value: Number(manualForm.value),
        notes: manualForm.notes || null,
        source_station_id: manualForm.sourceStationId ? Number(manualForm.sourceStationId) : null,
      };
      if (manualForm.useManualPoint) {
        payload.lat = Number(manualForm.lat);
        payload.lon = Number(manualForm.lon);
      } else {
        payload.location_id = Number(manualForm.locationId);
      }
      if (manualForm.id) {
        await apiClient.put(`/admin/manual-entries/${manualForm.dataType}/${manualForm.id}`, payload, {
          headers: requestHeaders,
        });
      } else {
        await apiClient.post("/admin/manual-entries", payload, { headers: requestHeaders });
      }
      await Promise.all([loadManualEntries(), loadOverview()]);
      showBanner("ok", manualForm.id ? "Đã cập nhật bản ghi nhập tay." : "Đã tạo bản ghi nhập tay.");
      closeModal();
      setManualForm(MANUAL_FORM_DEFAULT);
    } catch (error) {
      showBanner("error", extractErrorMessage(error, "Không lưu được bản ghi nhập tay."));
    } finally {
      setSubmitting(false);
    }
  }

  function confirmManualDelete(entry) {
    setModal({ type: "manual-delete", payload: entry });
  }

  async function removeManualEntry(entry) {
    setSubmitting(true);
    try {
      await apiClient.delete(`/admin/manual-entries/${entry.data_type}/${entry.id}`, { headers: requestHeaders });
      await Promise.all([loadManualEntries(), loadOverview()]);
      showBanner("ok", "Đã xóa bản ghi nhập tay.");
      closeModal();
    } catch (error) {
      showBanner("error", extractErrorMessage(error, "Không xóa được bản ghi nhập tay."));
    } finally {
      setSubmitting(false);
    }
  }

  function openLocationCreate() {
    setLocationForm(LOCATION_FORM_DEFAULT);
    setModal({ type: "location-form", payload: null });
  }

  function openLocationDetails(location) {
    setModal({ type: "location-detail", payload: location });
  }

  function openLocationEdit(location) {
    setLocationForm({
      id: location.id,
      name: location.name || "",
      province: location.province || "",
      geometryText: location.geometry ? JSON.stringify(location.geometry, null, 2) : "",
    });
    setModal({ type: "location-form", payload: location });
  }

  async function saveLocation(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name: locationForm.name,
        province: locationForm.province,
        geometry: parseGeometryText(locationForm.geometryText),
      };
      if (locationForm.id) {
        await apiClient.put(`/admin/locations/${locationForm.id}`, payload, { headers: requestHeaders });
      } else {
        await apiClient.post("/admin/locations", payload, { headers: requestHeaders });
      }
      await Promise.all([loadLocations(), loadOverview()]);
      showBanner("ok", locationForm.id ? "Đã cập nhật địa điểm." : "Đã tạo địa điểm mới.");
      closeModal();
      setLocationForm(LOCATION_FORM_DEFAULT);
    } catch (error) {
      showBanner("error", extractErrorMessage(error, error.message || "Không lưu được địa điểm."));
    } finally {
      setSubmitting(false);
    }
  }

  function confirmLocationDelete(location) {
    setModal({ type: "location-delete", payload: location });
  }

  async function removeLocation(locationId) {
    setSubmitting(true);
    try {
      await apiClient.delete(`/admin/locations/${locationId}`, { headers: requestHeaders });
      await Promise.all([loadLocations(), loadOverview()]);
      showBanner("ok", "Đã xóa địa điểm.");
      closeModal();
    } catch (error) {
      showBanner("error", extractErrorMessage(error, "Không xóa được địa điểm."));
    } finally {
      setSubmitting(false);
    }
  }

  function openActivityDetails(row) {
    setModal({ type: "activity-detail", payload: row });
  }

  async function runGeeSync(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        location_id: Number(geeSyncForm.locationId),
        start_date: geeSyncForm.startDate,
        end_date: geeSyncForm.endDate,
        data_types: geeSyncForm.dataTypes,
      };
      const response = await apiClient.post("/admin/gee/sync", payload, { headers: requestHeaders });
      setGeeResult(response.data?.data || null);
      await Promise.all([loadGeeStatus(), loadOverview()]);
      showBanner("ok", "Đã gửi yêu cầu đồng bộ dữ liệu từ GEE.");
    } catch (error) {
      showBanner("error", extractErrorMessage(error, "Không thể đồng bộ dữ liệu từ GEE."));
    } finally {
      setSubmitting(false);
    }
  }

  function toggleGeeType(type) {
    setGeeSyncForm((prev) => {
      const exists = prev.dataTypes.includes(type);
      const nextTypes = exists ? prev.dataTypes.filter((item) => item !== type) : [...prev.dataTypes, type];
      return {
        ...prev,
        dataTypes: nextTypes.length ? nextTypes : [type],
      };
    });
  }

  function renderOverviewSection() {
    return (
      <div className="panel-stack">
        <section className="grid-4">
          <div className="card stat">
            <h4>Người dùng</h4>
            <p>{overview?.stats?.users_total ?? users.length}</p>
          </div>
          <div className="card stat">
            <h4>Trạm quan trắc</h4>
            <p>{overview?.stats?.stations_total ?? stations.length}</p>
          </div>
          <div className="card stat">
            <h4>Nhập liệu thủ công</h4>
            <p>{overview?.stats?.manual_entries_total ?? manualEntries.length}</p>
          </div>
          <div className="card stat">
            <h4>Địa điểm quản lý</h4>
            <p>{overview?.stats?.locations_total ?? locations.length}</p>
          </div>
        </section>

        <section className="split-grid">
          <div className="card insight-card">
            <h3>Trạng thái vận hành</h3>
            <div className="admin-mini-grid">
              <div className="admin-mini-panel">
                <span>GEE service</span>
                <strong>{geeStatus?.status === "online" ? "Online" : "Offline"}</strong>
              </div>
              <div className="admin-mini-panel">
                <span>Email xác thực</span>
                <strong>{overview?.stats?.users_verified ?? 0} tài khoản</strong>
              </div>
              <div className="admin-mini-panel">
                <span>Hoạt động 7 ngày</span>
                <strong>{overview?.stats?.recent_activity_7d ?? activityRows.length}</strong>
              </div>
              <div className="admin-mini-panel">
                <span>Vùng phân tích lưu</span>
                <strong>{overview?.stats?.custom_areas_total ?? 0}</strong>
              </div>
            </div>
          </div>
          <div className="card insight-card">
            <h3>Dữ liệu khí hậu trong CSDL</h3>
            <div className="admin-record-list">
              <div><span>Lượng mưa</span><strong>{overview?.climate_records?.rainfall ?? "-"}</strong></div>
              <div><span>Nhiệt độ</span><strong>{overview?.climate_records?.temperature ?? "-"}</strong></div>
              <div><span>Độ ẩm đất</span><strong>{overview?.climate_records?.soil_moisture ?? "-"}</strong></div>
              <div><span>NDVI</span><strong>{overview?.climate_records?.ndvi ?? "-"}</strong></div>
              <div><span>TVDI</span><strong>{overview?.climate_records?.tvdi ?? "-"}</strong></div>
            </div>
          </div>
        </section>

        <section className="card table-card">
          <SectionToolbar
            title="Tài khoản mới gần đây"
            description="Giúp admin theo dõi nhanh user vừa đăng ký và trạng thái xác thực email."
            action={
              <button type="button" className="btn btn-secondary" onClick={() => setActiveSection("users")}>
                Quản lý người dùng
              </button>
            }
          />
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Họ tên</th>
                  <th>Email</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Xác thực email</th>
                  <th>Ngày tạo</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.recent_users || []).map((item) => (
                  <tr key={item.id}>
                    <td>{item.username}</td>
                    <td>{item.full_name || "-"}</td>
                    <td>{item.email}</td>
                    <td><span className="chip">{item.role}</span></td>
                    <td><span className={`chip ${item.is_active ? "" : "danger"}`}>{item.is_active ? "Hoạt động" : "Tạm khóa"}</span></td>
                    <td>{item.email_verified_at ? formatDateTime(item.email_verified_at) : "Chưa xác thực"}</td>
                    <td>{formatDateTime(item.created_at)}</td>
                  </tr>
                ))}
                {!overview?.recent_users?.length ? (
                  <tr>
                    <td colSpan={7}>Chưa có người dùng nào.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  function renderUsersSection() {
    return (
      <section className="card table-card">
        <SectionToolbar title="Người dùng" description="Danh sách đầy đủ tài khoản hệ thống cùng các hành động quản trị an toàn.">
          <div className="field admin-toolbar__field">
            <label>Tìm kiếm</label>
            <input value={userFilters.q} onChange={(event) => setUserFilters((prev) => ({ ...prev, q: event.target.value }))} placeholder="Username, email, họ tên" />
          </div>
          <div className="field admin-toolbar__field">
            <label>Vai trò</label>
            <select value={userFilters.role} onChange={(event) => setUserFilters((prev) => ({ ...prev, role: event.target.value }))}>
              <option value="">Tất cả</option>
              <option value="admin">admin</option>
              <option value="user">user</option>
            </select>
          </div>
          <div className="field admin-toolbar__field">
            <label>Trạng thái</label>
            <select value={userFilters.status} onChange={(event) => setUserFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Tạm khóa</option>
            </select>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void loadUsers()}>
            Lọc danh sách
          </button>
        </SectionToolbar>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Xác thực email</th>
                <th>Đăng nhập gần nhất</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.username}</strong>
                    <div className="muted-text">{row.full_name || "Chưa có họ tên"}</div>
                  </td>
                  <td>{row.email}</td>
                  <td><span className="chip">{row.role}</span></td>
                  <td><span className={`chip ${row.is_active ? "" : "danger"}`}>{row.is_active ? "Hoạt động" : "Tạm khóa"}</span></td>
                  <td>{row.email_verified_at ? "Đã xác thực" : "Chưa xác thực"}</td>
                  <td>{formatDateTime(row.last_login)}</td>
                  <td>
                    <div className="admin-action-group">
                      <IconActionButton title="Xem chi tiết" onClick={() => openUserDetails(row)}>
                        <Eye size={16} />
                      </IconActionButton>
                      <IconActionButton title="Chỉnh sửa người dùng" onClick={() => openUserEdit(row)}>
                        <Pencil size={16} />
                      </IconActionButton>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length ? (
                <tr>
                  <td colSpan={7}>Không có người dùng phù hợp bộ lọc hiện tại.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderStationsSection() {
    return (
      <section className="card table-card">
        <SectionToolbar
          title="Trạm quan trắc"
          description="Danh sách trạm là nguồn dữ liệu nền cho WebGIS, IDW và các thao tác nhập liệu thủ công."
          action={
            <button type="button" className="btn btn-primary" onClick={openStationCreate}>
              <Plus size={16} /> Thêm trạm
            </button>
          }
        />
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tên trạm</th>
                <th>Loại</th>
                <th>Tọa độ</th>
                <th>Lượng mưa</th>
                <th>Địa chỉ</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {stations.map((station) => (
                <tr key={station.id}>
                  <td>
                    <strong>{station.name}</strong>
                    <div className="muted-text">{station.source_description || "Chưa có mô tả nguồn"}</div>
                  </td>
                  <td><span className="chip">{station.station_type}</span></td>
                  <td>{formatNumber(station.lat, 6)}, {formatNumber(station.lon, 6)}</td>
                  <td>{station.rainfall_mm === null ? "-" : `${formatNumber(station.rainfall_mm)} mm`}</td>
                  <td>{station.address || "-"}</td>
                  <td>
                    <div className="admin-action-group">
                      <IconActionButton title="Xem chi tiết" onClick={() => openStationDetails(station)}>
                        <Eye size={16} />
                      </IconActionButton>
                      <IconActionButton title="Sửa trạm" onClick={() => openStationEdit(station)}>
                        <Pencil size={16} />
                      </IconActionButton>
                      <IconActionButton title="Xóa trạm" variant="danger" onClick={() => confirmStationDelete(station)}>
                        <Trash2 size={16} />
                      </IconActionButton>
                    </div>
                  </td>
                </tr>
              ))}
              {!stations.length ? (
                <tr>
                  <td colSpan={6}>Chưa có trạm quan trắc nào trong hệ thống.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderManualEntriesSection() {
    return (
      <section className="card table-card">
        <SectionToolbar
          title="Nhập liệu thủ công"
          description="Toàn bộ bản ghi đo tay đều được gom về đây để admin rà, sửa và xóa khi cần."
          action={
            <button type="button" className="btn btn-primary" onClick={openManualCreate}>
              <Plus size={16} /> Thêm bản ghi
            </button>
          }
        >
          <div className="field admin-toolbar__field">
            <label>Loại dữ liệu</label>
            <select value={manualFilters.dataType} onChange={(event) => setManualFilters((prev) => ({ ...prev, dataType: event.target.value }))}>
              <option value="">Tất cả</option>
              {DATA_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field admin-toolbar__field">
            <label>Địa điểm</label>
            <select value={manualFilters.locationId} onChange={(event) => setManualFilters((prev) => ({ ...prev, locationId: event.target.value }))}>
              <option value="">Tất cả</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} - {location.province}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void loadManualEntries()}>
            Lọc dữ liệu
          </button>
        </SectionToolbar>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Loại</th>
                <th>Địa điểm</th>
                <th>Ngày</th>
                <th>Giá trị</th>
                <th>Trạm nguồn</th>
                <th>Ghi chú</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {manualEntries.map((entry) => {
                const option = DATA_TYPE_OPTIONS.find((item) => item.value === entry.data_type);
                return (
                  <tr key={`${entry.data_type}-${entry.id}`}>
                    <td>{option?.label || entry.data_type}</td>
                    <td>
                      <strong>{entry.location_name || entry.location_id}</strong>
                      <div className="muted-text">{entry.location_province || "-"}</div>
                    </td>
                    <td>{formatDate(entry.date)}</td>
                    <td>{formatNumber(entry.value, 4)} {option?.unit || ""}</td>
                    <td>{entry.source_station_name || "-"}</td>
                    <td>{entry.notes || "-"}</td>
                    <td>
                      <div className="admin-action-group">
                        <IconActionButton title="Xem chi tiết" onClick={() => openManualDetails(entry)}>
                          <Eye size={16} />
                        </IconActionButton>
                        <IconActionButton title="Sửa bản ghi" onClick={() => openManualEdit(entry)}>
                          <Pencil size={16} />
                        </IconActionButton>
                        <IconActionButton title="Xóa bản ghi" variant="danger" onClick={() => confirmManualDelete(entry)}>
                          <Trash2 size={16} />
                        </IconActionButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!manualEntries.length ? (
                <tr>
                  <td colSpan={7}>Chưa có bản ghi nhập tay phù hợp.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderLocationsSection() {
    return (
      <section className="card table-card">
        <SectionToolbar
          title="Địa điểm"
          description="Location là lớp kết nối giữa dashboard, phân tích khí hậu, ranh giới và dữ liệu nhập tay."
          action={
            <button type="button" className="btn btn-primary" onClick={openLocationCreate}>
              <Plus size={16} /> Thêm địa điểm
            </button>
          }
        />
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Tỉnh</th>
                <th>Tâm điểm</th>
                <th>Geometry</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location.id}>
                  <td>{location.name}</td>
                  <td>{location.province}</td>
                  <td>
                    {location.centroid_lat && location.centroid_lng
                      ? `${formatNumber(location.centroid_lat, 5)}, ${formatNumber(location.centroid_lng, 5)}`
                      : "Chưa có"}
                  </td>
                  <td>{location.has_geometry ? "Có geometry" : "Không có"}</td>
                  <td>
                    <div className="admin-action-group">
                      <IconActionButton title="Xem chi tiết" onClick={() => openLocationDetails(location)}>
                        <Eye size={16} />
                      </IconActionButton>
                      <IconActionButton title="Sửa địa điểm" onClick={() => openLocationEdit(location)}>
                        <Pencil size={16} />
                      </IconActionButton>
                      <IconActionButton title="Xóa địa điểm" variant="danger" onClick={() => confirmLocationDelete(location)}>
                        <Trash2 size={16} />
                      </IconActionButton>
                    </div>
                  </td>
                </tr>
              ))}
              {!locations.length ? (
                <tr>
                  <td colSpan={5}>Chưa có địa điểm nào.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderGeeSection() {
    return (
      <div className="panel-stack">
        <section className="split-grid">
          <div className="card insight-card">
            <h3>Trạng thái dịch vụ GEE</h3>
            <div className="admin-record-list">
              <div><span>Service</span><strong>{geeStatus?.status || "Không xác định"}</strong></div>
              <div><span>Earth Engine</span><strong>{geeStatus?.gee_initialized ? "Đã khởi tạo" : "Chưa khởi tạo"}</strong></div>
              <div><span>Project</span><strong>{geeStatus?.gee_project || geeStatus?.project || "-"}</strong></div>
            </div>
          </div>
          <div className="card insight-card">
            <h3>Khuyến nghị vận hành</h3>
            <p>
              Hãy đồng bộ theo từng location và dải ngày nhỏ khi cần kiểm tra dữ liệu. Việc này giúp admin vận hành ổn
              định hơn thay vì nạp ồ ạt toàn bộ dữ liệu ngay trong một lượt.
            </p>
          </div>
        </section>

        <section className="card admin-sync-card">
          <SectionToolbar title="Đồng bộ từ GEE" description="Chọn location và loại dữ liệu cần nạp vào CSDL vận hành.">
            <button type="button" className="btn btn-secondary" onClick={() => void loadGeeStatus()}>
              Kiểm tra trạng thái
            </button>
          </SectionToolbar>
          <form className="admin-form-grid" onSubmit={runGeeSync}>
            <div className="field">
              <label>Location</label>
              <select value={geeSyncForm.locationId} onChange={(event) => setGeeSyncForm((prev) => ({ ...prev, locationId: event.target.value }))}>
                <option value="">Chọn location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} - {location.province}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Từ ngày</label>
              <input type="date" value={geeSyncForm.startDate} onChange={(event) => setGeeSyncForm((prev) => ({ ...prev, startDate: event.target.value }))} />
            </div>
            <div className="field">
              <label>Đến ngày</label>
              <input type="date" value={geeSyncForm.endDate} onChange={(event) => setGeeSyncForm((prev) => ({ ...prev, endDate: event.target.value }))} />
            </div>
            <div className="field admin-form-grid__wide">
              <label>Loại dữ liệu</label>
              <div className="admin-checkbox-group">
                {DATA_TYPE_OPTIONS.map((option) => (
                  <label key={option.value} className="checkbox-inline">
                    <input type="checkbox" checked={geeSyncForm.dataTypes.includes(option.value)} onChange={() => toggleGeeType(option.value)} />
                    {option.label}
                  </label>
                ))}
                <label className="checkbox-inline">
                  <input type="checkbox" checked={geeSyncForm.dataTypes.includes("tvdi")} onChange={() => toggleGeeType("tvdi")} />
                  TVDI
                </label>
              </div>
            </div>
            <div className="actions">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Đang đồng bộ..." : "Chạy đồng bộ GEE"}
              </button>
            </div>
          </form>
        </section>

        <section className="card table-card">
          <SectionToolbar title="Kết quả đồng bộ gần nhất" description="Giữ nguyên dữ liệu phản hồi để admin và reviewer dễ đối chiếu khi kiểm thử." />
          <pre className="admin-json-block">{geeResult ? JSON.stringify(geeResult, null, 2) : "Chưa có lượt đồng bộ nào trong phiên này."}</pre>
        </section>
      </div>
    );
  }

  function renderActivitySection() {
    return (
      <section className="card table-card">
        <SectionToolbar title="Nhật ký hệ thống" description="Theo dõi activity log và dấu vết thao tác quản trị trong toàn hệ thống.">
          <div className="field admin-toolbar__field">
            <label>Tìm kiếm</label>
            <input value={activityFilters.q} onChange={(event) => setActivityFilters((prev) => ({ ...prev, q: event.target.value }))} placeholder="page, activity type, username" />
          </div>
          <div className="field admin-toolbar__field">
            <label>Activity type</label>
            <input value={activityFilters.activityType} onChange={(event) => setActivityFilters((prev) => ({ ...prev, activityType: event.target.value }))} placeholder="Ví dụ: admin_create_station" />
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void loadActivity()}>
            Tải nhật ký
          </button>
        </SectionToolbar>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>User</th>
                <th>Loại hoạt động</th>
                <th>Trang</th>
                <th>IP</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {activityRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{row.username || `user#${row.user_id}`}</td>
                  <td>{row.activity_type}</td>
                  <td>{row.page}</td>
                  <td>{row.ip_address || "-"}</td>
                  <td>
                    <div className="admin-action-group">
                      <IconActionButton title="Xem chi tiết log" onClick={() => openActivityDetails(row)}>
                        <Eye size={16} />
                      </IconActionButton>
                    </div>
                  </td>
                </tr>
              ))}
              {!activityRows.length ? (
                <tr>
                  <td colSpan={6}>Chưa có activity log phù hợp.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderSection() {
    if (activeSection === "users") {
      return renderUsersSection();
    }
    if (activeSection === "stations") {
      return renderStationsSection();
    }
    if (activeSection === "manual") {
      return renderManualEntriesSection();
    }
    if (activeSection === "locations") {
      return renderLocationsSection();
    }
    if (activeSection === "gee") {
      return renderGeeSection();
    }
    if (activeSection === "activity") {
      return renderActivitySection();
    }
    return renderOverviewSection();
  }

  function renderModal() {
    if (!modal.type) {
      return null;
    }

    if (modal.type === "user-detail") {
      const target = modal.payload;
      return (
        <AdminModal
          open
          title={`Chi tiết người dùng: ${target.username}`}
          subtitle="Thông tin này được lấy trực tiếp từ bảng users và trạng thái xác thực hiện tại."
          onClose={closeModal}
          actions={<button type="button" className="btn btn-secondary" onClick={closeModal}>Đóng</button>}
        >
          <DetailGrid
            items={[
              { label: "Username", value: target.username },
              { label: "Họ tên", value: target.full_name || "-" },
              { label: "Email", value: target.email },
              { label: "Vai trò", value: target.role },
              { label: "Trạng thái", value: target.is_active ? "Hoạt động" : "Tạm khóa" },
              { label: "Email xác thực", value: target.email_verified_at ? formatDateTime(target.email_verified_at) : "Chưa xác thực" },
              { label: "Đăng nhập gần nhất", value: formatDateTime(target.last_login) },
              { label: "Ngày tạo", value: formatDateTime(target.created_at) },
            ]}
          />
        </AdminModal>
      );
    }

    if (modal.type === "user-edit") {
      const target = modal.payload;
      return (
        <AdminModal
          open
          title={`Cập nhật người dùng: ${target.username}`}
          subtitle="Cho phép admin chỉnh họ tên, quyền và trạng thái truy cập."
          onClose={closeModal}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Hủy</button>
              <button type="button" className="btn btn-primary" onClick={() => void saveUser()} disabled={submitting}>
                {submitting ? "Đang lưu..." : "Lưu cập nhật"}
              </button>
            </>
          }
        >
          <div className="admin-form-grid">
            <div className="field">
              <label>ID người dùng</label>
              <input value={userForm.id || ""} disabled />
            </div>
            <div className="field">
              <label>Họ tên</label>
              <input value={userForm.fullName} onChange={(event) => setUserForm((prev) => ({ ...prev, fullName: event.target.value }))} />
            </div>
            <div className="field">
              <label>Vai trò</label>
              <select value={userForm.role} onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value }))}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div className="field">
              <label className="checkbox-inline">
                <input type="checkbox" checked={userForm.isActive} onChange={(event) => setUserForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                Tài khoản đang hoạt động
              </label>
            </div>
          </div>
        </AdminModal>
      );
    }

    if (modal.type === "station-detail") {
      const station = modal.payload;
      return (
        <AdminModal open title={`Chi tiết trạm: ${station.name}`} onClose={closeModal} actions={<button type="button" className="btn btn-secondary" onClick={closeModal}>Đóng</button>}>
          <DetailGrid
            items={[
              { label: "Tên trạm", value: station.name },
              { label: "Loại", value: station.station_type },
              { label: "Vĩ độ", value: formatNumber(station.lat, 6) },
              { label: "Kinh độ", value: formatNumber(station.lon, 6) },
              { label: "Lượng mưa", value: station.rainfall_mm === null ? "-" : `${formatNumber(station.rainfall_mm)} mm` },
              { label: "Địa chỉ", value: station.address || "-" },
              { label: "Mô tả nguồn", value: station.source_description || "-" },
            ]}
          />
        </AdminModal>
      );
    }

    if (modal.type === "station-form") {
      const editing = Boolean(stationForm.id);
      return (
        <AdminModal
          open
          wide
          title={editing ? "Cập nhật trạm quan trắc" : "Thêm trạm quan trắc"}
          subtitle="Biểu mẫu quản trị nội bộ cho master data trạm."
          onClose={closeModal}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Hủy</button>
              <button type="submit" className="btn btn-primary" form="admin-station-form" disabled={submitting}>
                {submitting ? "Đang lưu..." : editing ? "Cập nhật" : "Tạo mới"}
              </button>
            </>
          }
        >
          <form id="admin-station-form" className="admin-form-grid" onSubmit={saveStation}>
            <div className="field">
              <label>Tên trạm</label>
              <input value={stationForm.name} onChange={(event) => setStationForm((prev) => ({ ...prev, name: event.target.value }))} />
            </div>
            <div className="field">
              <label>Loại trạm</label>
              <select value={stationForm.stationType} onChange={(event) => setStationForm((prev) => ({ ...prev, stationType: event.target.value }))}>
                <option value="water">water</option>
                <option value="air">air</option>
                <option value="rainfall">rainfall</option>
              </select>
            </div>
            <div className="field">
              <label>Vĩ độ</label>
              <input type="number" step="0.000001" value={stationForm.lat} onChange={(event) => setStationForm((prev) => ({ ...prev, lat: event.target.value }))} />
            </div>
            <div className="field">
              <label>Kinh độ</label>
              <input type="number" step="0.000001" value={stationForm.lon} onChange={(event) => setStationForm((prev) => ({ ...prev, lon: event.target.value }))} />
            </div>
            <div className="field">
              <label>Lượng mưa hiện tại (mm)</label>
              <input type="number" step="0.01" value={stationForm.rainfallMm} onChange={(event) => setStationForm((prev) => ({ ...prev, rainfallMm: event.target.value }))} />
            </div>
            <div className="field admin-form-grid__wide">
              <label>Địa chỉ / mô tả vị trí</label>
              <input value={stationForm.address} onChange={(event) => setStationForm((prev) => ({ ...prev, address: event.target.value }))} />
            </div>
            <div className="field admin-form-grid__wide">
              <label>Mô tả nguồn</label>
              <textarea rows={3} value={stationForm.sourceDescription} onChange={(event) => setStationForm((prev) => ({ ...prev, sourceDescription: event.target.value }))} />
            </div>
          </form>
        </AdminModal>
      );
    }

    if (modal.type === "station-delete") {
      const station = modal.payload;
      return (
        <AdminModal
          open
          title="Xóa trạm quan trắc"
          subtitle={`Bạn sắp xóa trạm "${station.name}". Thao tác này sẽ ảnh hưởng đến dữ liệu thủ công nếu trạm đang được tham chiếu.`}
          onClose={closeModal}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Hủy</button>
              <button type="button" className="btn btn-danger" onClick={() => void removeStation(station.id)} disabled={submitting}>
                {submitting ? "Đang xóa..." : "Xóa trạm"}
              </button>
            </>
          }
        >
          <DetailGrid items={[{ label: "Tên trạm", value: station.name }, { label: "Loại", value: station.station_type }, { label: "Địa chỉ", value: station.address || "-" }]} />
        </AdminModal>
      );
    }

    if (modal.type === "manual-detail") {
      const entry = modal.payload;
      const option = DATA_TYPE_OPTIONS.find((item) => item.value === entry.data_type);
      return (
        <AdminModal open title="Chi tiết bản ghi nhập tay" onClose={closeModal} actions={<button type="button" className="btn btn-secondary" onClick={closeModal}>Đóng</button>}>
          <DetailGrid
            items={[
              { label: "Loại dữ liệu", value: option?.label || entry.data_type },
              { label: "Địa điểm", value: entry.location_name || entry.location_id },
              { label: "Tỉnh", value: entry.location_province || "-" },
              { label: "Ngày đo", value: formatDate(entry.date) },
              { label: "Giá trị", value: `${formatNumber(entry.value, 4)} ${option?.unit || ""}` },
              { label: "Trạm nguồn", value: entry.source_station_name || "-" },
              { label: "Ghi chú", value: entry.notes || "-" },
            ]}
          />
        </AdminModal>
      );
    }

    if (modal.type === "manual-form") {
      const editing = Boolean(manualForm.id);
      const selectedUnit = DATA_TYPE_OPTIONS.find((option) => option.value === manualForm.dataType)?.unit || "";
      return (
        <AdminModal
          open
          wide
          title={editing ? "Cập nhật bản ghi nhập tay" : "Thêm bản ghi nhập tay"}
          subtitle="Popup CRUD dành cho quản trị dữ liệu do con người nhập thủ công."
          onClose={closeModal}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Hủy</button>
              <button type="submit" className="btn btn-primary" form="admin-manual-form" disabled={submitting}>
                {submitting ? "Đang lưu..." : editing ? "Cập nhật" : "Tạo mới"}
              </button>
            </>
          }
        >
          <form id="admin-manual-form" className="admin-form-grid" onSubmit={saveManualEntry}>
            <div className="field">
              <label>Loại dữ liệu</label>
              <select value={manualForm.dataType} onChange={(event) => setManualForm((prev) => ({ ...prev, dataType: event.target.value }))}>
                {DATA_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Ngày đo</label>
              <input type="date" value={manualForm.date} onChange={(event) => setManualForm((prev) => ({ ...prev, date: event.target.value }))} />
            </div>
            <div className="field">
              <label>Giá trị ({selectedUnit})</label>
              <input type="number" step="0.0001" value={manualForm.value} onChange={(event) => setManualForm((prev) => ({ ...prev, value: event.target.value }))} />
            </div>
            <div className="field">
              <label className="checkbox-inline">
                <input type="checkbox" checked={manualForm.useManualPoint} onChange={(event) => setManualForm((prev) => ({ ...prev, useManualPoint: event.target.checked }))} />
                Nhập theo lat/lon
              </label>
            </div>
            {manualForm.useManualPoint ? (
              <>
                <div className="field">
                  <label>Lat</label>
                  <input type="number" step="0.000001" value={manualForm.lat} onChange={(event) => setManualForm((prev) => ({ ...prev, lat: event.target.value }))} />
                </div>
                <div className="field">
                  <label>Lon</label>
                  <input type="number" step="0.000001" value={manualForm.lon} onChange={(event) => setManualForm((prev) => ({ ...prev, lon: event.target.value }))} />
                </div>
              </>
            ) : (
              <div className="field admin-form-grid__wide">
                <label>Địa điểm</label>
                <select value={manualForm.locationId} onChange={(event) => setManualForm((prev) => ({ ...prev, locationId: event.target.value }))}>
                  <option value="">Chọn địa điểm</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} - {location.province}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Trạm nguồn</label>
              <select value={manualForm.sourceStationId} onChange={(event) => setManualForm((prev) => ({ ...prev, sourceStationId: event.target.value }))}>
                <option value="">Không chọn</option>
                {stations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field admin-form-grid__wide">
              <label>Ghi chú</label>
              <textarea rows={3} value={manualForm.notes} onChange={(event) => setManualForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </div>
          </form>
        </AdminModal>
      );
    }

    if (modal.type === "manual-delete") {
      const entry = modal.payload;
      const option = DATA_TYPE_OPTIONS.find((item) => item.value === entry.data_type);
      return (
        <AdminModal
          open
          title="Xóa bản ghi nhập tay"
          subtitle="Bản ghi này sẽ bị xóa khỏi bảng dữ liệu thủ công tương ứng."
          onClose={closeModal}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Hủy</button>
              <button type="button" className="btn btn-danger" onClick={() => void removeManualEntry(entry)} disabled={submitting}>
                {submitting ? "Đang xóa..." : "Xóa bản ghi"}
              </button>
            </>
          }
        >
          <DetailGrid items={[{ label: "Loại dữ liệu", value: option?.label || entry.data_type }, { label: "Địa điểm", value: entry.location_name || entry.location_id }, { label: "Ngày đo", value: formatDate(entry.date) }]} />
        </AdminModal>
      );
    }

    if (modal.type === "location-detail") {
      const location = modal.payload;
      return (
        <AdminModal open wide title={`Chi tiết địa điểm: ${location.name}`} onClose={closeModal} actions={<button type="button" className="btn btn-secondary" onClick={closeModal}>Đóng</button>}>
          <DetailGrid
            items={[
              { label: "Tên địa điểm", value: location.name },
              { label: "Tỉnh", value: location.province },
              { label: "Tâm điểm", value: location.centroid_lat && location.centroid_lng ? `${formatNumber(location.centroid_lat, 5)}, ${formatNumber(location.centroid_lng, 5)}` : "Chưa có" },
              { label: "Geometry", value: location.has_geometry ? "Có geometry" : "Không có" },
            ]}
          />
          <pre className="admin-json-block">{location.geometry ? JSON.stringify(location.geometry, null, 2) : "Không có geometry JSON."}</pre>
        </AdminModal>
      );
    }

    if (modal.type === "location-form") {
      const editing = Boolean(locationForm.id);
      return (
        <AdminModal
          open
          wide
          title={editing ? "Cập nhật địa điểm" : "Thêm địa điểm"}
          subtitle="Popup CRUD cho lớp location lõi của dự án."
          onClose={closeModal}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Hủy</button>
              <button type="submit" className="btn btn-primary" form="admin-location-form" disabled={submitting}>
                {submitting ? "Đang lưu..." : editing ? "Cập nhật" : "Tạo mới"}
              </button>
            </>
          }
        >
          <form id="admin-location-form" className="admin-form-grid" onSubmit={saveLocation}>
            <div className="field">
              <label>Tên địa điểm</label>
              <input value={locationForm.name} onChange={(event) => setLocationForm((prev) => ({ ...prev, name: event.target.value }))} />
            </div>
            <div className="field">
              <label>Tỉnh / khu vực</label>
              <input value={locationForm.province} onChange={(event) => setLocationForm((prev) => ({ ...prev, province: event.target.value }))} />
            </div>
            <div className="field admin-form-grid__wide">
              <label>Geometry JSON (tùy chọn)</label>
              <textarea
                rows={10}
                value={locationForm.geometryText}
                onChange={(event) => setLocationForm((prev) => ({ ...prev, geometryText: event.target.value }))}
                placeholder='{"type":"Feature","geometry":{"type":"Point","coordinates":[107.18,16.75]}}'
              />
            </div>
          </form>
        </AdminModal>
      );
    }

    if (modal.type === "location-delete") {
      const location = modal.payload;
      return (
        <AdminModal
          open
          title="Xóa địa điểm"
          subtitle={`Bạn sắp xóa location "${location.name}". Thao tác này chỉ nên dùng khi chắc chắn location không còn cần thiết.`}
          onClose={closeModal}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Hủy</button>
              <button type="button" className="btn btn-danger" onClick={() => void removeLocation(location.id)} disabled={submitting}>
                {submitting ? "Đang xóa..." : "Xóa địa điểm"}
              </button>
            </>
          }
        >
          <DetailGrid items={[{ label: "Tên", value: location.name }, { label: "Tỉnh", value: location.province }, { label: "Geometry", value: location.has_geometry ? "Có" : "Không" }]} />
        </AdminModal>
      );
    }

    if (modal.type === "activity-detail") {
      const row = modal.payload;
      return (
        <AdminModal open wide title="Chi tiết activity log" subtitle="Bản ghi audit giúp truy lại thao tác quản trị và hoạt động hệ thống." onClose={closeModal} actions={<button type="button" className="btn btn-secondary" onClick={closeModal}>Đóng</button>}>
          <DetailGrid
            items={[
              { label: "User", value: row.username || `user#${row.user_id}` },
              { label: "Loại hoạt động", value: row.activity_type },
              { label: "Trang", value: row.page },
              { label: "IP", value: row.ip_address || "-" },
              { label: "Thời gian", value: formatDateTime(row.created_at) },
            ]}
          />
          <pre className="admin-json-block">{stringifyDetails(row.details)}</pre>
        </AdminModal>
      );
    }

    return null;
  }

  if (booting) {
    return (
      <div className="admin-site">
        <div className="auth-shell">
          <div className="card auth-card">
            <h1>Đang khởi tạo khu quản trị</h1>
            <p>Hệ thống đang tải các module admin, quyền truy cập và dữ liệu vận hành cốt lõi.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-site">
      <div className="admin-site__header">
        <div className="admin-site__brand">
          <div className="admin-site__logo">AG</div>
          <div>
            <strong>Admin GIS Climate Lab</strong>
            <span>Không gian quản trị tách biệt khỏi giao diện client</span>
          </div>
        </div>
        <div className="admin-site__header-actions">
          <span className="chip">Đăng nhập: {user?.username}</span>
          <button type="button" className="btn btn-secondary" onClick={() => void refreshSection()}>
            <RefreshCcw size={16} className={refreshing ? "spin" : ""} />
            {refreshing ? "Đang làm mới..." : "Làm mới khu hiện tại"}
          </button>
          <button type="button" className="btn btn-danger" onClick={handleLogout}>
            <LogOut size={16} />
            Đăng xuất
          </button>
        </div>
      </div>

      {banner.message ? <div className={`status ${banner.type}`}>{banner.message}</div> : null}

      <div className="admin-console admin-console--standalone">
        <aside className="card admin-sidebar">
          <div className="admin-sidebar__header">
            <span className="chip">Admin Console</span>
            <p>Site quản trị chỉ dành cho admin, tối ưu cho CRUD và vận hành dữ liệu khí hậu - GIS.</p>
          </div>
          <nav className="admin-sidebar__nav">
            {SECTION_ITEMS.map((item) => {
              const Icon = item.icon;
              const badge = sectionBadges[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`admin-sidebar__item ${activeSection === item.id ? "active" : ""}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className="admin-sidebar__label">
                    <Icon size={18} />
                    {item.label}
                  </span>
                  {badge !== null && badge !== undefined ? (
                    <span className={`admin-sidebar__badge ${typeof badge === "string" ? "is-status" : ""}`}>{badge}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="admin-content">
          <div className="card admin-section-header">
            <div>
              <h2>{SECTION_ITEMS.find((item) => item.id === activeSection)?.label || "Tổng quan"}</h2>
              <p>{SECTION_COPY[activeSection]}</p>
            </div>
          </div>
          {renderSection()}
        </section>
      </div>

      {renderModal()}
    </div>
  );
}
