import pool from "../config/db.js";

class SoilMoistureModel {
  // Lấy dữ liệu theo khoảng thời gian
  static async getByDateRange(locationId, startDate, endDate) {
    const result = await pool.query(
      `SELECT date, sm_surface, sm_rootzone, sm_profile, source 
       FROM soil_moisture_data
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
        AVG(sm_surface) as avg_surface,
        AVG(sm_rootzone) as avg_rootzone,
        AVG(sm_profile) as avg_profile,
        MIN(sm_surface) as min_surface,
        MAX(sm_surface) as max_surface,
        COUNT(*) as data_points
       FROM soil_moisture_data
       WHERE location_id = $1 AND EXTRACT(YEAR FROM date) = $2
       GROUP BY EXTRACT(MONTH FROM date)
       ORDER BY month`,
      [locationId, year]
    );
    return result.rows;
  }

  // Phân loại độ ẩm đất
  static classifySoilMoisture(value) {
    if (value === null) return { level: 'unknown', description: 'Không có dữ liệu' };
    if (value < 0.1) return { level: 'very_dry', description: 'Rất khô', color: '#d73027' };
    if (value < 0.2) return { level: 'dry', description: 'Khô', color: '#fc8d59' };
    if (value < 0.3) return { level: 'normal', description: 'Bình thường', color: '#fee08b' };
    if (value < 0.4) return { level: 'moist', description: 'Ẩm', color: '#91cf60' };
    return { level: 'wet', description: 'Rất ẩm', color: '#1a9850' };
  }
}

export default SoilMoistureModel;

