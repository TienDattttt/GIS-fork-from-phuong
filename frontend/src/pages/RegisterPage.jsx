import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register, resendVerificationEmail, isAuthenticated, ready } = useAuth();
  const [form, setForm] = useState({
    username: "",
    email: "",
    fullName: "",
    password: "",
    confirmPassword: ""
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess(null);
    setResendMessage("");
    if (form.password !== form.confirmPassword) {
      setError("Mật khẩu xác nhận không khớp");
      return;
    }
    if (form.password.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự");
      return;
    }

    setLoading(true);
    try {
      const result = await register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim() || null
      });
      setSuccess(result);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Đăng ký thất bại");
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setResending(true);
    setResendMessage("");
    try {
      const result = await resendVerificationEmail({ email: form.email.trim() });
      setResendMessage(result.message);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Chưa thể gửi lại email xác thực");
    } finally {
      setResending(false);
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
        <h1>Đăng ký</h1>
        <p>Tạo tài khoản mới để sử dụng hệ thống phân tích GIS khí hậu.</p>
        {error && <div className="status error">{error}</div>}
        {success ? (
          <div className="auth-helper-box auth-helper-box--success">
            <strong>Đăng ký thành công</strong>
            <p>{success.message}</p>
            {resendMessage ? <div className="status ok">{resendMessage}</div> : null}
            <div className="auth-actions-row">
              <button type="button" className="btn btn-secondary" onClick={onResend} disabled={resending}>
                {resending ? "Đang gửi lại..." : "Gửi lại email xác thực"}
              </button>
              <Link to="/login" className="btn btn-primary">
                Đi tới đăng nhập
              </Link>
            </div>
          </div>
        ) : (
          <>
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
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="fullName">Họ và tên</label>
                <input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
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
              <div className="field">
                <label htmlFor="confirmPassword">Xác nhận mật khẩu</label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Đang xử lý..." : "Đăng ký"}
              </button>
            </form>
            <p className="auth-link">
              Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
