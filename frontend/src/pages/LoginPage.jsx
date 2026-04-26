import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

function parseAuthError(error) {
  return {
    message: error.response?.data?.error?.message || "Đăng nhập thất bại",
    details: error.response?.data?.error?.details || {},
    code: error.response?.data?.error?.code || ""
  };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, resendVerificationEmail, isAuthenticated, ready } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendState, setResendState] = useState({ visible: false, loading: false, message: "", error: "" });

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setResendState({ visible: false, loading: false, message: "", error: "" });
    setLoading(true);
    try {
      await login(form.username.trim(), form.password);
      navigate("/", { replace: true });
    } catch (err) {
      const authError = parseAuthError(err);
      setError(authError.message);
      setResendState((prev) => ({
        ...prev,
        visible: authError.code === "email_not_verified"
      }));
    } finally {
      setLoading(false);
    }
  };

  const onResendVerification = async () => {
    setResendState({ visible: true, loading: true, message: "", error: "" });
    try {
      const result = await resendVerificationEmail({ username: form.username.trim() });
      setResendState({ visible: true, loading: false, message: result.message, error: "" });
    } catch (err) {
      setResendState({
        visible: true,
        loading: false,
        message: "",
        error: err.response?.data?.error?.message || "Chưa thể gửi lại email xác thực"
      });
    }
  };

  useEffect(() => {
    if (ready && isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate, ready]);

  return (
    <div className="auth-shell">
      <section className="card auth-card">
        <h1>Đăng nhập</h1>
        <p>Truy cập hệ thống phân tích khí hậu và WebGIS của Do An GIS.</p>
        {error && <div className="status error">{error}</div>}
        {resendState.message && <div className="status ok">{resendState.message}</div>}
        {resendState.error && <div className="status warn">{resendState.error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="username">Tên đăng nhập</label>
            <input
              id="username"
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Mật khẩu</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Đang xử lý..." : "Đăng nhập"}
          </button>
        </form>

        {resendState.visible ? (
          <div className="auth-helper-box">
            <strong>Tài khoản của bạn chưa xác thực email.</strong>
            <p>Chúng ta có thể gửi lại email xác thực về hộp thư đã đăng ký cho tài khoản này.</p>
            <button type="button" className="btn btn-secondary" onClick={onResendVerification} disabled={resendState.loading}>
              {resendState.loading ? "Đang gửi lại..." : "Gửi lại email xác thực"}
            </button>
          </div>
        ) : null}

        <div className="auth-secondary-links">
          <Link to="/forgot-password">Quên mật khẩu?</Link>
          <span>Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link></span>
        </div>
      </section>
    </div>
  );
}
