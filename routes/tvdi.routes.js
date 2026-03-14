// ============================================
// routes/tvdi.routes.js
// ============================================
import express from "express";
import TvdiModel from "../models/tvdi.model.js";

const tvdiRouter = express.Router();

// GET: Lấy dữ liệu theo khoảng thời gian
tvdiRouter.get("/", async (req, res) => {
  try {
    const { location_id, start, end } = req.query;
    
    if (!location_id || !start || !end) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const data = await TvdiModel.getByDateRange(location_id, start, end);
    
    const avgTvdi = data.length > 0 
      ? data.reduce((sum, r) => sum + parseFloat(r.tvdi_mean || 0), 0) / data.length 
      : 0;
    
    const droughtDays = data.filter(d => 
      d.drought_class === 'severe' || d.drought_class === 'extreme'
    ).length;

    res.json({
      data,
      statistics: {
        average: avgTvdi.toFixed(4),
        min: Math.min(...data.map(d => parseFloat(d.tvdi_min || 0))).toFixed(4),
        max: Math.max(...data.map(d => parseFloat(d.tvdi_max || 0))).toFixed(4),
        avg_lst: (data.reduce((s, r) => s + parseFloat(r.lst_mean || 0), 0) / data.length).toFixed(2),
        drought_days: droughtDays,
        drought_pct: ((droughtDays / data.length) * 100).toFixed(2),
        classification: TvdiModel.classifyTvdi(avgTvdi),
        records: data.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Thống kê theo tháng
tvdiRouter.get("/monthly", async (req, res) => {
  try {
    const { location_id, year } = req.query;
    const data = await TvdiModel.getMonthlyStats(location_id, year);
    
    res.json({
      year: parseInt(year),
      monthly_data: data.map(row => ({
        month: parseInt(row.month),
        avg_tvdi: parseFloat(row.avg_tvdi || 0).toFixed(4),
        min_tvdi: parseFloat(row.min_tvdi || 0).toFixed(4),
        max_tvdi: parseFloat(row.max_tvdi || 0).toFixed(4),
        avg_lst: parseFloat(row.avg_lst || 0).toFixed(2),
        avg_drought_pct: parseFloat(row.avg_drought_pct || 0).toFixed(2),
        severe_days: parseInt(row.severe_days || 0),
        classification: TvdiModel.classifyTvdi(parseFloat(row.avg_tvdi))
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Tổng hợp hạn theo năm
tvdiRouter.get("/drought-summary", async (req, res) => {
  try {
    const { location_id, start_year, end_year } = req.query;
    const data = await TvdiModel.getDroughtSummary(location_id, start_year, end_year);
    
    // Group by year
    const grouped = {};
    data.forEach(row => {
      const year = parseInt(row.year);
      if (!grouped[year]) grouped[year] = {};
      grouped[year][row.drought_class] = {
        count: parseInt(row.count),
        avg_tvdi: parseFloat(row.avg_tvdi || 0).toFixed(4)
      };
    });
    
    res.json({ drought_summary: grouped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Các đợt hạn nặng
tvdiRouter.get("/severe-events", async (req, res) => {
  try {
    const { location_id, start, end } = req.query;
    const data = await TvdiModel.getSevereDroughtEvents(location_id, start, end);
    
    res.json({
      severe_events: data.map(row => ({
        date: row.date,
        tvdi: parseFloat(row.tvdi_mean).toFixed(4),
        lst: parseFloat(row.lst_mean).toFixed(2),
        drought_pct: parseFloat(row.drought_area_pct).toFixed(2),
        classification: row.drought_class
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { tvdiRouter };