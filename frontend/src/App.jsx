import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import ActivityPage from "./pages/ActivityPage";
import DataEntryPage from "./pages/DataEntryPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MapPage from "./pages/MapPage";
import NdviPage from "./pages/NdviPage";
import NotFoundPage from "./pages/NotFoundPage";
import RainfallCalculationPage from "./pages/RainfallCalculationPage";
import RainfallPage from "./pages/RainfallPage";
import RegisterPage from "./pages/RegisterPage";
import SoilMoisturePage from "./pages/SoilMoisturePage";
import StationsPage from "./pages/StationsPage";
import TemperaturePage from "./pages/TemperaturePage";
import TvdiPage from "./pages/TvdiPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomePage />} />
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
