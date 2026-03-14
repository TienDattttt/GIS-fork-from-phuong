// controllers/temperature.controller.js
import TemperatureModel from "../models/temperature.model.js";

class TemperatureController {
  static async getDataByRange(req, res) {
    try {
      const { location_id, start, end } = req.query;
      
      if (!location_id || !start || !end) {
        return res.status(400).json({ 
          error: "Missing required parameters" 
        });
      }

      const data = await TemperatureModel.getByDateRange(location_id, start, end);
      
      const avgTemp = data.length > 0 
        ? data.reduce((sum, row) => sum + parseFloat(row.temp_mean || 0), 0) / data.length 
        : 0;

      res.json({
        data,
        statistics: {
          average: avgTemp.toFixed(2),
          min: Math.min(...data.map(d => parseFloat(d.temp_min || 0))).toFixed(2),
          max: Math.max(...data.map(d => parseFloat(d.temp_max || 0))).toFixed(2),
          days: data.length
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getMonthlyStats(req, res) {
    try {
      const { location_id, year } = req.query;
      const data = await TemperatureModel.getMonthlyStats(location_id, year);
      
      res.json({
        year: parseInt(year),
        monthly_data: data.map(row => ({
          month: parseInt(row.month),
          avg_temp: parseFloat(row.avg_temp || 0).toFixed(2),
          avg_min: parseFloat(row.avg_min || 0).toFixed(2),
          avg_max: parseFloat(row.avg_max || 0).toFixed(2),
          min_temp: parseFloat(row.min_temp || 0).toFixed(2),
          max_temp: parseFloat(row.max_temp || 0).toFixed(2)
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

export default TemperatureController;