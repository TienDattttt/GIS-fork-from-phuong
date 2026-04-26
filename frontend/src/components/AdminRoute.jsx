import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function AdminRoute({ children }) {
  const { ready, isAuthenticated, user } = useAuth();

  if (!ready) {
    return <div className="auth-shell">Đang tải quyền quản trị...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return children;
}
