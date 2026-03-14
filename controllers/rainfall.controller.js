import RainfallModel from "../models/rainfall.model.js";
import { calculateTrend, calculateAnomaly } from "../utils/helpers.js";

class RainfallController {
  // Lấy dữ liệu theo khoảng thời gian
  static async getDataByRange(req, res) {
    try {
      const { location_id, start, end } = req.query;
      
      if (!location_id || !start || !end) {
        return res.status(400).json({ 
          error: "Missing required parameters: location_id, start, end" 
        });
      }

      const data = await RainfallModel.getByDateRange(location_id, start, end);
      
      // Tính toán thống kê cơ bản
      const total = data.reduce((sum, row) => sum + parseFloat(row.rainfall_mm || 0), 0);
      const avg = data.length > 0 ? total / data.length : 0;
      const max = Math.max(...data.map(row => parseFloat(row.rainfall_mm || 0)));

      res.json({
        data,
        statistics: {
          total: total.toFixed(2),
          average: avg.toFixed(2),
          max: max.toFixed(2),
          days: data.length
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Thống kê theo tháng
  static async getMonthlyStats(req, res) {
    try {
      const { location_id, year } = req.query;
      
      if (!location_id || !year) {
        return res.status(400).json({ 
          error: "Missing required parameters: location_id, year" 
        });
      }

      const data = await RainfallModel.getMonthlyStats(location_id, year);
      
      res.json({
        year: parseInt(year),
        monthly_data: data.map(row => ({
          month: parseInt(row.month),
          total: parseFloat(row.total_rainfall || 0).toFixed(2),
          average: parseFloat(row.avg_rainfall || 0).toFixed(2),
          max: parseFloat(row.max_rainfall || 0).toFixed(2),
          days: parseInt(row.days_count)
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Thống kê theo năm
  static async getYearlyStats(req, res) {
    try {
      const { location_id, start_year, end_year } = req.query;
      
      if (!location_id || !start_year || !end_year) {
        return res.status(400).json({ 
          error: "Missing required parameters: location_id, start_year, end_year" 
        });
      }

      const data = await RainfallModel.getYearlyStats(
        location_id, 
        start_year, 
        end_year
      );
      
      // Tính xu hướng
      const trend = calculateTrend(data.map(d => ({
        x: parseInt(d.year),
        y: parseFloat(d.total_rainfall)
      })));

      res.json({
        yearly_data: data.map(row => ({
          year: parseInt(row.year),
          total: parseFloat(row.total_rainfall || 0).toFixed(2),
          average: parseFloat(row.avg_rainfall || 0).toFixed(2),
          max: parseFloat(row.max_rainfall || 0).toFixed(2)
        })),
        trend
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // So sánh hai khoảng thời gian
  static async comparePeriods(req, res) {
    try {
      const { location_id, start1, end1, start2, end2 } = req.query;

      const data1 = await RainfallModel.getByDateRange(location_id, start1, end1);
      const data2 = await RainfallModel.getByDateRange(location_id, start2, end2);

      const total1 = data1.reduce((sum, row) => sum + parseFloat(row.rainfall_mm || 0), 0);
      const total2 = data2.reduce((sum, row) => sum + parseFloat(row.rainfall_mm || 0), 0);

      const avg1 = data1.length > 0 ? total1 / data1.length : 0;
      const avg2 = data2.length > 0 ? total2 / data2.length : 0;

      res.json({
        period_1: {
          start: start1,
          end: end1,
          total: total1.toFixed(2),
          average: avg1.toFixed(2),
          days: data1.length
        },
        period_2: {
          start: start2,
          end: end2,
          total: total2.toFixed(2),
          average: avg2.toFixed(2),
          days: data2.length
        },
        comparison: {
          difference: (total1 - total2).toFixed(2),
          percentage_change: total2 !== 0 ? (((total1 - total2) / total2) * 100).toFixed(2) : 0
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // So sánh hai địa điểm
  static async compareLocations(req, res) {
    try {
      const { location1, location2, start, end } = req.query;

      const data1 = await RainfallModel.getByDateRange(location1, start, end);
      const data2 = await RainfallModel.getByDateRange(location2, start, end);

      const total1 = data1.reduce((sum, row) => sum + parseFloat(row.rainfall_mm || 0), 0);
      const total2 = data2.reduce((sum, row) => sum + parseFloat(row.rainfall_mm || 0), 0);

      res.json({
        location_1: {
          id: location1,
          total: total1.toFixed(2),
          average: (data1.length > 0 ? total1 / data1.length : 0).toFixed(2)
        },
        location_2: {
          id: location2,
          total: total2.toFixed(2),
          average: (data2.length > 0 ? total2 / data2.length : 0).toFixed(2)
        },
        difference: (total1 - total2).toFixed(2)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

export default RainfallController;