import pool from "../config/db.js";

class TvdiModel {
  // Lấy dữ liệu theo khoảng thời gian
  static async getByDateRange(locationId, startDate, endDate) {
    const result = await pool.query(
      `SELECT date, tvdi_mean, tvdi_min, tvdi_max, lst_mean,
              drought_area_pct, drought_class, source 
       FROM tvdi_data
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
        AVG(tvdi_mean) as avg_tvdi,
        MIN(tvdi_min) as min_tvdi,
        MAX(tvdi_max) as max_tvdi,
        AVG(lst_mean) as avg_lst,
        AVG(drought_area_pct) as avg_drought_pct,
        COUNT(*) FILTER (WHERE drought_class IN ('severe', 'extreme')) as severe_days,
        COUNT(*) as data_points
       FROM tvdi_data
       WHERE location_id = $1 AND EXTRACT(YEAR FROM date) = $2
       GROUP BY EXTRACT(MONTH FROM date)
       ORDER BY month`,
      [locationId, year]
    );
    return result.rows;
  }

  // Thống kê hạn theo năm
  static async getDroughtSummary(locationId, startYear, endYear) {
    const result = await pool.query(
      `SELECT 
        EXTRACT(YEAR FROM date) as year,
        drought_class,
        COUNT(*) as count,
        AVG(tvdi_mean) as avg_tvdi
       FROM tvdi_data
       WHERE location_id = $1 
         AND EXTRACT(YEAR FROM date) BETWEEN $2 AND $3
       GROUP BY EXTRACT(YEAR FROM date), drought_class
       ORDER BY year, drought_class`,
      [locationId, startYear, endYear]
    );
    return result.rows;
  }

  // Lấy các đợt hạn nặng
  static async getSevereDroughtEvents(locationId, startDate, endDate) {
    const result = await pool.query(
      `SELECT date, tvdi_mean, lst_mean, drought_area_pct, drought_class
       FROM tvdi_data
       WHERE location_id = $1 
         AND date BETWEEN $2 AND $3
         AND drought_class IN ('severe', 'extreme')
       ORDER BY tvdi_mean DESC
       LIMIT 20`,
      [locationId, startDate, endDate]
    );
    return result.rows;
  }

  // Phân loại TVDI
  static classifyTvdi(value) {
    if (value === null) return { level: 'unknown', description: 'Không có dữ liệu', color: '#999' };
    if (value < 0.2) return { level: 'wet', description: 'Ẩm ướt', color: '#2166ac' };
    if (value < 0.4) return { level: 'normal', description: 'Bình thường', color: '#67a9cf' };
    if (value < 0.6) return { level: 'moderate', description: 'Hạn nhẹ', color: '#fddbc7' };
    if (value < 0.8) return { level: 'severe', description: 'Hạn nặng', color: '#ef8a62' };
    return { level: 'extreme', description: 'Hạn cực đoan', color: '#b2182b' };
  }

  // Tính chỉ số cảnh báo hạn
  static calculateDroughtAlert(tvdi, ndvi, soilMoisture) {
    let alert = 'normal';
    let score = 0;
    
    // TVDI weight: 40%
    if (tvdi > 0.8) score += 40;
    else if (tvdi > 0.6) score += 25;
    else if (tvdi > 0.4) score += 10;
    
    // NDVI weight: 30%
    if (ndvi < 0.1) score += 30;
    else if (ndvi < 0.2) score += 20;
    else if (ndvi < 0.3) score += 10;
    
    // Soil Moisture weight: 30%
    if (soilMoisture < 0.1) score += 30;
    else if (soilMoisture < 0.2) score += 20;
    else if (soilMoisture < 0.3) score += 10;
    
    if (score >= 70) alert = 'extreme';
    else if (score >= 50) alert = 'severe';
    else if (score >= 30) alert = 'moderate';
    else if (score >= 15) alert = 'watch';
    
    return { alert, score };
  }
}

export default TvdiModel;