import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";

const DATA_TYPE_OPTIONS = [
  { value: "rainfall", label: "Lượng mưa", unit: "mm" },
  { value: "temperature", label: "Nhiệt độ", unit: "°C" },
  { value: "soil_moisture", label: "Độ ẩm đất", unit: "m³/m³" },
  { value: "ndvi", label: "NDVI", unit: "NDVI" },
];

const DEFAULT_FORM = {
  dataType: "rainfall",
  locationId: "",
  locationSearch: "",
  useManualPoint: false,
  lat: "",
  lon: "",
  date: "2020-01-01",
  value: "",
  notes: "",
  sourceStationId: "",
};

export default function DataEntryPage() {
  const { logActivity } = useAuth();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [locations, setLocations] = useState([]);
  const [stations, setStations] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("ok");

  useEffect(() => {
    void logActivity("page_view", "data-entry");
  }, [logActivity]);

  useEffect(() => {
    const loadReferenceData = async () => {
      try {
        const [locationsResponse, stationsResponse] = await Promise.all([
          apiClient.get("/locations"),
          apiClient.get("/climate/stations"),
        ]);
        setLocations(locationsResponse.data?.data || []);
        setStations(stationsResponse.data?.data || []);
      } catch {
        setStatus("Không tải được danh sách địa điểm hoặc trạm quan trắc.");
        setStatusType("warn");
      }
    };
    void loadReferenceData();
  }, []);

  async function loadEntries() {
    setLoading(true);
    try {
      const requests = DATA_TYPE_OPTIONS.map((option) =>
        apiClient.get("/climate/manual-entry", {
          params: {
            data_type: option.value,
            location_id: form.locationId || undefined,
          },
        })
      );
      const responses = await Promise.all(requests);
      const merged = responses
        .flatMap((response) => response.data?.data || [])
        .sort((left, right) => String(right.date).localeCompare(String(left.date)) || Number(right.id) - Number(left.id))
        .slice(0, 20);
      setEntries(merged);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.locationId]);

  const filteredLocations = useMemo(() => {
    const query = form.locationSearch.trim().toLowerCase();
    if (!query) {
      return locations;
    }
    return locations.filter(
      (location) =>
        String(location.name || "").toLowerCase().includes(query) ||
        String(location.province || "").toLowerCase().includes(query)
    );
  }, [form.locationSearch, locations]);

  const unitLabel = useMemo(
    () => DATA_TYPE_OPTIONS.find((option) => option.value === form.dataType)?.unit || "",
    [form.dataType]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");

    const payload = {
      data_type: form.dataType,
      date: form.date,
      value: Number(form.value),
      notes: form.notes,
      source_station_id: form.sourceStationId || null,
    };

    if (form.useManualPoint) {
      payload.lat = Number(form.lat);
      payload.lon = Number(form.lon);
    } else {
      payload.location_id = Number(form.locationId);
    }

    try {
      await apiClient.post("/climate/manual-entry", payload);
      setStatus("Đã lưu bản ghi nhập tay.");
      setStatusType("ok");
      setForm((prev) => ({
        ...prev,
        value: "",
        notes: "",
        sourceStationId: "",
      }));
      await loadEntries();
    } catch (error) {
      setStatus(error.response?.data?.error?.message || "Không lưu được bản ghi nhập tay.");
      setStatusType("error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry) {
    try {
      await apiClient.delete(`/climate/manual-entry/${entry.data_type}/${entry.id}`);
      setStatus("Đã xóa bản ghi nhập tay.");
      setStatusType("ok");
      await loadEntries();
    } catch (error) {
      setStatus(error.response?.data?.error?.message || "Không xóa được bản ghi nhập tay.");
      setStatusType("error");
    }
  }

  return (
    <div className="panel-stack">
      <section className="card page-header">
        <h1>Nhập liệu môi trường thủ công</h1>
        <p>Trang này cho phép bổ sung dữ liệu đo thủ công để hệ thống không chỉ phụ thuộc vào Google Earth Engine.</p>
      </section>

      {status ? <div className={`status ${statusType}`}>{status}</div> : null}

      <section className="card controls">
        <form className="manual-entry-grid" onSubmit={handleSubmit}>
          <div className="field">
            <label>Data type</label>
            <select value={form.dataType} onChange={(event) => setForm((prev) => ({ ...prev, dataType: event.target.value }))}>
              {DATA_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Tìm địa điểm</label>
            <input
              value={form.locationSearch}
              onChange={(event) => setForm((prev) => ({ ...prev, locationSearch: event.target.value }))}
              placeholder="Nhập tên địa điểm hoặc tỉnh"
            />
          </div>
          <div className="field">
            <label>Địa điểm hiện có</label>
            <select
              value={form.locationId}
              onChange={(event) => setForm((prev) => ({ ...prev, locationId: event.target.value }))}
              disabled={form.useManualPoint}
            >
              <option value="">Chọn địa điểm</option>
              {filteredLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} - {location.province}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Tọa độ thủ công</label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={form.useManualPoint}
                onChange={(event) => setForm((prev) => ({ ...prev, useManualPoint: event.target.checked }))}
              />
              Nhập lat/lon thủ công
            </label>
          </div>
          {form.useManualPoint ? (
            <>
              <div className="field">
                <label>Lat</label>
                <input type="number" step="0.000001" value={form.lat} onChange={(event) => setForm((prev) => ({ ...prev, lat: event.target.value }))} />
              </div>
              <div className="field">
                <label>Lon</label>
                <input type="number" step="0.000001" value={form.lon} onChange={(event) => setForm((prev) => ({ ...prev, lon: event.target.value }))} />
              </div>
            </>
          ) : null}
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} />
          </div>
          <div className="field">
            <label>Value ({unitLabel})</label>
            <input type="number" step="0.0001" value={form.value} onChange={(event) => setForm((prev) => ({ ...prev, value: event.target.value }))} />
          </div>
          <div className="field">
            <label>Source station</label>
            <select value={form.sourceStationId} onChange={(event) => setForm((prev) => ({ ...prev, sourceStationId: event.target.value }))}>
              <option value="">Không chọn trạm</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name} ({station.station_type})
                </option>
              ))}
            </select>
          </div>
          <div className="field manual-entry-grid__wide">
            <label>Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Ghi chú về nguồn đo, thiết bị, điều kiện quan trắc..."
            />
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Đang lưu..." : "Lưu dữ liệu thủ công"}
            </button>
          </div>
        </form>
      </section>

      <section className="card table-card">
        <div className="map-panel__header">
          <div>
            <h3>Bản ghi nhập tay gần đây</h3>
            <p>{loading ? "Đang tải..." : "Hiển thị tối đa 20 bản ghi thủ công mới nhất."}</p>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Data type</th>
              <th>Location</th>
              <th>Date</th>
              <th>Value</th>
              <th>Source station</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const unit = DATA_TYPE_OPTIONS.find((option) => option.value === entry.data_type)?.unit || "";
              return (
                <tr key={`${entry.data_type}-${entry.id}`}>
                  <td>{DATA_TYPE_OPTIONS.find((option) => option.value === entry.data_type)?.label || entry.data_type}</td>
                  <td>{entry.location_name || entry.location_id}</td>
                  <td>{entry.date}</td>
                  <td>
                    {Number(entry.value || 0).toFixed(4)} {unit}
                  </td>
                  <td>{entry.source_station_name || "-"}</td>
                  <td>{entry.notes || "-"}</td>
                  <td>
                    <button type="button" className="btn btn-danger" onClick={() => void deleteEntry(entry)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!entries.length && !loading ? (
              <tr>
                <td colSpan={7}>Chưa có bản ghi nhập tay nào.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
