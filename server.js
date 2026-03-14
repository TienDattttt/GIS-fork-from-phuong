import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: '*', // Cho phép tất cả origins trong dev
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser()); // ⭐ THÊM DÒ NÀY

// Import Routes
import rainfallRoutes from "./routes/rainfall.routes.js";
import temperatureRoutes from "./routes/temperature.routes.js";
import locationRoutes from "./routes/location.routes.js";
import { ndviRouter } from "./routes/ndvi.routes.js";
import { tvdiRouter } from "./routes/tvdi.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import geeRoutes from "./routes/gee.routes.js";
import authRoutes from "./routes/auth.routes.js"; // ⭐ THÊM
import activityRoutes from "./routes/activity.routes.js"; // ⭐ THÊM

// Import middleware
import { optionalAuth } from "./middleware/auth.middleware.js"; // ⭐ THÊM

// API Routes
app.use("/api/auth", authRoutes); // ⭐ THÊM
app.use("/api/activity", activityRoutes); // ⭐ THÊM

// Các routes khác có thể dùng optional auth để log activity
app.use("/api/rainfall", optionalAuth, rainfallRoutes);
app.use("/api/temperature", optionalAuth, temperatureRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/ndvi", optionalAuth, ndviRouter);
app.use("/api/tvdi", optionalAuth, tvdiRouter);
app.use("/api/dashboard", optionalAuth, dashboardRouter);
app.use("/api/gee", geeRoutes);

// Health check
app.get("/api", (req, res) => {
  res.json({ 
    message: "🌍 Web GIS Climate API",
    version: "2.1.0",
    endpoints: {
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        logout: "POST /api/auth/logout",
        me: "GET /api/auth/me"
      },
      activity: {
        log: "POST /api/activity/log",
        history: "GET /api/activity/history",
        stats: "GET /api/activity/stats"
      },
      locations: "/api/locations",
      rainfall: "/api/rainfall",
      temperature: "/api/temperature",
      ndvi: "/api/ndvi",
      tvdi: "/api/tvdi",
      dashboard: "/api/dashboard/overview"
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!", message: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           🌍 Web GIS Climate API Server                      ║
╠══════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                    ║
║  🔐 Auth enabled                                             ║
╠══════════════════════════════════════════════════════════════╣
║  API Endpoints:                                              ║
║  • POST /api/auth/register - Register new user              ║
║  • POST /api/auth/login - User login                        ║
║  • GET  /api/auth/me - Get current user                     ║
║  • POST /api/activity/log - Log activity                    ║
║  • GET  /api/activity/history - Get activity history        ║
╚══════════════════════════════════════════════════════════════╝
  `);
});