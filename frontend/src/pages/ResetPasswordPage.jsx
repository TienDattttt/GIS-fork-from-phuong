import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resetPassword } = useAuth();
  const token = searchParams.get("token") || "";

  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!token) {
      setError("Liên kết đặt lại mật khẩu không hợp lệ.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    if (form.password.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự.");
      return;
    }

    setLoading(true);
    try {
      const result = await resetPassword(token, form.password);
      setMessage(result.message);
      setTimeout(() => navigate("/login", { replace: true }), 1400);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Không thể đặt lại mật khẩu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="card auth-card">
        <h1>Đặt lại mật khẩu</h1>
        <p>Tạo mật khẩu mới để tiếp tục sử dụng tài khoản của bạn.</p>
        {!token && <div className="status warn">Liên kết này thiếu token xác thực. Vui lòng yêu cầu email mới.</div>}
        {error && <div className="status error">{error}</div>}
        {message && <div className="status ok">{message}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="password">Mật khẩu mới</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Xác nhận mật khẩu mới</label>
            <input
              id="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading || !token}>
            {loading ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
          </button>
        </form>
        <div className="auth-secondary-links">
          <Link to="/forgot-password">Yêu cầu liên kết mới</Link>
          <Link to="/login">Quay lại đăng nhập</Link>
        </div>
      </section>
    </div>
  );
}
