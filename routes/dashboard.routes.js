// ============================================
// routes/dashboard.routes.js - Tổng hợp
// ============================================
import express from "express";
import pool from "../config/db.js";

const dashboardRouter = express.Router();

// GET: Dữ liệu tổng hợp cho dashboard
dashboardRouter.get("/overview", async (req, res) => {
  try {
    const { location_id, start, end } = req.query;
    
    // Lấy tất cả dữ liệu song song
    const [rainfall, temp, sm, ndvi, tvdi] = await Promise.all([
      pool.query(
        `SELECT AVG(rainfall_mm) as avg, SUM(rainfall_mm) as total 
         FROM rainfall_data WHERE location_id=$1 AND date BETWEEN $2 AND $3`,
        [location_id, start, end]
      ),
      pool.query(
        `SELECT AVG(temp_mean) as avg, MIN(temp_min) as min, MAX(temp_max) as max 
         FROM temperature_data WHERE location_id=$1 AND date BETWEEN $2 AND $3`,
        [location_id, start, end]
      ),
      pool.query(
        `SELECT AVG(sm_surface) as avg_surface, AVG(sm_rootzone) as avg_root 
         FROM soil_moisture_data WHERE location_id=$1 AND date BETWEEN $2 AND $3`,
        [location_id, start, end]
      ),
      pool.query(
        `SELECT AVG(ndvi_mean) as avg, MIN(ndvi_min) as min, MAX(ndvi_max) as max,
                AVG(vegetation_area_pct) as veg_pct
         FROM ndvi_data WHERE location_id=$1 AND date BETWEEN $2 AND $3`,
        [location_id, start, end]
      ),
      pool.query(
        `SELECT AVG(tvdi_mean) as avg, AVG(drought_area_pct) as drought_pct,
                COUNT(*) FILTER (WHERE drought_class IN ('severe','extreme')) as drought_days
         FROM tvdi_data WHERE location_id=$1 AND date BETWEEN $2 AND $3`,
        [location_id, start, end]
      )
    ]);

    res.json({
      rainfall: {
        total: parseFloat(rainfall.rows[0].total || 0).toFixed(2),
        average: parseFloat(rainfall.rows[0].avg || 0).toFixed(2)
      },
      temperature: {
        average: parseFloat(temp.rows[0].avg || 0).toFixed(2),
        min: parseFloat(temp.rows[0].min || 0).toFixed(2),
        max: parseFloat(temp.rows[0].max || 0).toFixed(2)
      },
      soil_moisture: {
        surface: parseFloat(sm.rows[0].avg_surface || 0).toFixed(4),
        rootzone: parseFloat(sm.rows[0].avg_root || 0).toFixed(4)
      },
      ndvi: {
        average: parseFloat(ndvi.rows[0].avg || 0).toFixed(4),
        min: parseFloat(ndvi.rows[0].min || 0).toFixed(4),
        max: parseFloat(ndvi.rows[0].max || 0).toFixed(4),
        vegetation_pct: parseFloat(ndvi.rows[0].veg_pct || 0).toFixed(2)
      },
      tvdi: {
        average: parseFloat(tvdi.rows[0].avg || 0).toFixed(4),
        drought_area_pct: parseFloat(tvdi.rows[0].drought_pct || 0).toFixed(2),
        drought_days: parseInt(tvdi.rows[0].drought_days || 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Time series tổng hợp
dashboardRouter.get("/timeseries", async (req, res) => {
  try {
    const { location_id, start, end } = req.query;
    
    const result = await pool.query(`
      SELECT 
        COALESCE(r.date, t.date, s.date, n.date, tv.date) as date,
        r.rainfall_mm,
        t.temp_mean, t.temp_min, t.temp_max,
        s.sm_surface, s.sm_rootzone,
        n.ndvi_mean,
        tv.tvdi_mean, tv.drought_class
      FROM rainfall_data r
      FULL OUTER JOIN temperature_data t 
        ON r.location_id = t.location_id AND r.date = t.date
      FULL OUTER JOIN soil_moisture_data s 
        ON r.location_id = s.location_id AND r.date = s.date
      FULL OUTER JOIN ndvi_data n 
        ON r.location_id = n.location_id AND r.date = n.date
      FULL OUTER JOIN tvdi_data tv 
        ON r.location_id = tv.location_id AND r.date = tv.date
      WHERE (r.location_id = $1 OR t.location_id = $1 OR s.location_id = $1 
             OR n.location_id = $1 OR tv.location_id = $1)
        AND COALESCE(r.date, t.date, s.date, n.date, tv.date) BETWEEN $2 AND $3
      ORDER BY date
    `, [location_id, start, end]);
    
    res.json({ timeseries: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { dashboardRouter };