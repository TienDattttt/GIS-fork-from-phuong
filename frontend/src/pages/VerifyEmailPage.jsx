import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const { verifyEmail, resendVerificationEmail } = useAuth();
  const token = searchParams.get("token") || "";
  const email = searchParams.get("email") || "";

  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Đang xác thực email của bạn...");
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function runVerification() {
      if (!token) {
        setStatus("error");
        setMessage("Liên kết xác thực không hợp lệ.");
        return;
      }

      try {
        const result = await verifyEmail(token);
        if (!cancelled) {
          setStatus("success");
          setMessage(result.message);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setMessage(err.response?.data?.error?.message || "Không thể xác thực email.");
        }
      }
    }

    runVerification();
    return () => {
      cancelled = true;
    };
  }, [token, verifyEmail]);

  const onResend = async () => {
    if (!email) {
      setResendMessage("Liên kết này không mang theo email để gửi lại xác thực. Hãy quay về màn đăng nhập hoặc đăng ký.");
      return;
    }
    setResending(true);
    setResendMessage("");
    try {
      const result = await resendVerificationEmail({ email });
      setResendMessage(result.message);
    } catch (err) {
      setResendMessage(err.response?.data?.error?.message || "Chưa thể gửi lại email xác thực.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="card auth-card">
        <h1>Xác thực email</h1>
        <p>Hệ thống đang kiểm tra liên kết xác thực tài khoản của bạn.</p>
        <div className={`status ${status === "success" ? "ok" : status === "error" ? "error" : "warn"}`}>{message}</div>
        {resendMessage ? <div className="status warn">{resendMessage}</div> : null}
        <div className="auth-secondary-links auth-secondary-links--stack">
          {status === "error" ? (
            <button type="button" className="btn btn-secondary" onClick={onResend} disabled={resending}>
              {resending ? "Đang gửi lại..." : "Gửi lại email xác thực"}
            </button>
          ) : null}
          <Link to="/login">Đi tới đăng nhập</Link>
        </div>
      </section>
    </div>
  );
}
