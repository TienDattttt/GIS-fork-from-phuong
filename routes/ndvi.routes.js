// ============================================
// routes/ndvi.routes.js
// ============================================
import express from "express";
import NdviModel from "../models/ndvi.model.js";

const ndviRouter = express.Router();

// GET: Lấy dữ liệu theo khoảng thời gian
ndviRouter.get("/", async (req, res) => {
  try {
    const { location_id, start, end } = req.query;
    
    if (!location_id || !start || !end) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const data = await NdviModel.getByDateRange(location_id, start, end);
    
    const avgNdvi = data.length > 0 
      ? data.reduce((sum, r) => sum + parseFloat(r.ndvi_mean || 0), 0) / data.length 
      : 0;

    res.json({
      data,
      statistics: {
        average: avgNdvi.toFixed(4),
        min: Math.min(...data.map(d => parseFloat(d.ndvi_min || 0))).toFixed(4),
        max: Math.max(...data.map(d => parseFloat(d.ndvi_max || 0))).toFixed(4),
        avg_vegetation_pct: (data.reduce((s, r) => s + parseFloat(r.vegetation_area_pct || 0), 0) / data.length).toFixed(2),
        classification: NdviModel.classifyNdvi(avgNdvi),
        records: data.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Thống kê theo tháng
ndviRouter.get("/monthly", async (req, res) => {
  try {
    const { location_id, year } = req.query;
    const data = await NdviModel.getMonthlyStats(location_id, year);
    
    res.json({
      year: parseInt(year),
      monthly_data: data.map(row => ({
        month: parseInt(row.month),
        avg_ndvi: parseFloat(row.avg_ndvi || 0).toFixed(4),
        min_ndvi: parseFloat(row.min_ndvi || 0).toFixed(4),
        max_ndvi: parseFloat(row.max_ndvi || 0).toFixed(4),
        avg_veg_pct: parseFloat(row.avg_veg_pct || 0).toFixed(2),
        classification: NdviModel.classifyNdvi(parseFloat(row.avg_ndvi))
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Thống kê theo năm
ndviRouter.get("/yearly", async (req, res) => {
  try {
    const { location_id, start_year, end_year } = req.query;
    const data = await NdviModel.getYearlyStats(location_id, start_year, end_year);
    
    res.json({
      yearly_data: data.map(row => ({
        year: parseInt(row.year),
        avg_ndvi: parseFloat(row.avg_ndvi || 0).toFixed(4),
        min_ndvi: parseFloat(row.min_ndvi || 0).toFixed(4),
        max_ndvi: parseFloat(row.max_ndvi || 0).toFixed(4),
        avg_veg_pct: parseFloat(row.avg_veg_pct || 0).toFixed(2)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { ndviRouter };