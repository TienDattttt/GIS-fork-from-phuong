import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await forgotPassword(email.trim());
      setMessage(result.message);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Không thể xử lý yêu cầu lúc này");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="card auth-card">
        <h1>Quên mật khẩu</h1>
        <p>Nhập email đã đăng ký. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu nếu tài khoản tồn tại.</p>
        {error && <div className="status error">{error}</div>}
        {message && <div className="status ok">{message}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Đang gửi..." : "Gửi liên kết đặt lại mật khẩu"}
          </button>
        </form>
        <div className="auth-secondary-links">
          <Link to="/login">Quay lại đăng nhập</Link>
          <span>Chưa có tài khoản? <Link to="/register">Đăng ký</Link></span>
        </div>
      </section>
    </div>
  );
}
