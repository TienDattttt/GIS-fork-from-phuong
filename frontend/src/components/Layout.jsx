import { useEffect, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/map", label: "Bản đồ" },
  { to: "/stations", label: "Trạm quan trắc" },
  { to: "/rainfall", label: "Lượng mưa" },
  { to: "/rainfall-calculation", label: "Tính mưa IDW" },
  { to: "/temperature", label: "Nhiệt độ" },
  { to: "/soil-moisture", label: "Độ ẩm đất" },
  { to: "/ndvi", label: "NDVI" },
  { to: "/tvdi", label: "TVDI" },
  { to: "/data-entry", label: "Nhập liệu" },
  { to: "/activity", label: "Hoạt động" },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell">
      <header className={`topbar ${menuOpen ? "menu-open" : ""}`}>
        <div className="topbar-brand-row">
          <NavLink to="/" className="brand">
            GIS Climate Lab
          </NavLink>
          <button
            type="button"
            className="nav-toggle"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label={menuOpen ? "Đóng điều hướng" : "Mở điều hướng"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <nav className={`nav-links ${menuOpen ? "open" : ""}`}>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className={`user-box ${menuOpen ? "open" : ""}`}>
          <span>{user?.fullName || user?.username}</span>
          <button type="button" className="btn btn-danger" onClick={onLogout}>
            <LogOut size={16} /> Đăng xuất
          </button>
        </div>
      </header>

      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
