import pool from "../config/db.js";

class NdviModel {
  // Lấy dữ liệu theo khoảng thời gian
  static async getByDateRange(locationId, startDate, endDate) {
    const result = await pool.query(
      `SELECT date, ndvi_mean, ndvi_min, ndvi_max, ndvi_stddev, 
              vegetation_area_pct, source 
       FROM ndvi_data
       WHERE location_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date ASC`,
      [locationId, startDate, endDate]
    );
    return result.rows;
  }

  // Thống kê theo tháng
  static async getMonthlyStats(locationId, year) {
    const result = await pool.query(
      `SELECT 
        EXTRACT(MONTH FROM date) as month,
        AVG(ndvi_mean) as avg_ndvi,
        MIN(ndvi_min) as min_ndvi,
        MAX(ndvi_max) as max_ndvi,
        AVG(vegetation_area_pct) as avg_veg_pct,
        COUNT(*) as data_points
       FROM ndvi_data
       WHERE location_id = $1 AND EXTRACT(YEAR FROM date) = $2
       GROUP BY EXTRACT(MONTH FROM date)
       ORDER BY month`,
      [locationId, year]
    );
    return result.rows;
  }

  // Thống kê theo năm
  static async getYearlyStats(locationId, startYear, endYear) {
    const result = await pool.query(
      `SELECT 
        EXTRACT(YEAR FROM date) as year,
        AVG(ndvi_mean) as avg_ndvi,
        MIN(ndvi_min) as min_ndvi,
        MAX(ndvi_max) as max_ndvi,
        AVG(vegetation_area_pct) as avg_veg_pct
       FROM ndvi_data
       WHERE location_id = $1 
         AND EXTRACT(YEAR FROM date) BETWEEN $2 AND $3
       GROUP BY EXTRACT(YEAR FROM date)
       ORDER BY year`,
      [locationId, startYear, endYear]
    );
    return result.rows;
  }

  // Phân loại NDVI
  static classifyNdvi(value) {
    if (value === null) return { level: 'unknown', description: 'Không có dữ liệu' };
    if (value < 0) return { level: 'water', description: 'Nước/Không thực vật', color: '#0571b0' };
    if (value < 0.1) return { level: 'bare', description: 'Đất trống', color: '#ca0020' };
    if (value < 0.2) return { level: 'sparse', description: 'Thực vật thưa', color: '#f4a582' };
    if (value < 0.4) return { level: 'moderate', description: 'Thực vật vừa', color: '#92c5de' };
    if (value < 0.6) return { level: 'dense', description: 'Thực vật dày', color: '#4dac26' };
    return { level: 'very_dense', description: 'Thực vật rất dày', color: '#1b7837' };
  }
}

export default NdviModel;