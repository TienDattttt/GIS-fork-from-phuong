import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import AdminRoute from "./components/AdminRoute";
import ProtectedRoute from "./components/ProtectedRoute";
import ActivityPage from "./pages/ActivityPage";
import AdminConsolePage from "./pages/AdminConsolePage";
import AboutPage from "./pages/AboutPage";
import DataEntryPage from "./pages/DataEntryPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MapPage from "./pages/MapPage";
import NdviPage from "./pages/NdviPage";
import NotFoundPage from "./pages/NotFoundPage";
import RainfallCalculationPage from "./pages/RainfallCalculationPage";
import RainfallPage from "./pages/RainfallPage";
import RegisterPage from "./pages/RegisterPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SoilMoisturePage from "./pages/SoilMoisturePage";
import StationsPage from "./pages/StationsPage";
import TemperaturePage from "./pages/TemperaturePage";
import TvdiPage from "./pages/TvdiPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminConsolePage />
          </AdminRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="stations" element={<StationsPage />} />
        <Route path="rainfall" element={<RainfallPage />} />
        <Route path="rainfall-calculation" element={<RainfallCalculationPage />} />
        <Route path="temperature" element={<TemperaturePage />} />
        <Route path="soil-moisture" element={<SoilMoisturePage />} />
        <Route path="ndvi" element={<NdviPage />} />
        <Route path="tvdi" element={<TvdiPage />} />
        <Route path="data-entry" element={<DataEntryPage />} />
        <Route path="activity" element={<ActivityPage />} />
      </Route>
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
