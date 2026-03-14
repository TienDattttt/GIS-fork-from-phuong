import pool from "../config/db.js";

class RainfallModel {
  // Lấy dữ liệu theo khoảng thời gian
  static async getByDateRange(locationId, startDate, endDate) {
    const result = await pool.query(
      `SELECT date, rainfall_mm, source 
       FROM rainfall_data
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
        SUM(rainfall_mm) as total_rainfall,
        AVG(rainfall_mm) as avg_rainfall,
        MAX(rainfall_mm) as max_rainfall,
        COUNT(*) as days_count
       FROM rainfall_data
       WHERE location_id = $1 
         AND EXTRACT(YEAR FROM date) = $2
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
        SUM(rainfall_mm) as total_rainfall,
        AVG(rainfall_mm) as avg_rainfall,
        MAX(rainfall_mm) as max_rainfall
       FROM rainfall_data
       WHERE location_id = $1 
         AND EXTRACT(YEAR FROM date) BETWEEN $2 AND $3
       GROUP BY EXTRACT(YEAR FROM date)
       ORDER BY year`,
      [locationId, startYear, endYear]
    );
    return result.rows;
  }

  // Lưu dữ liệu mới
  static async create(locationId, date, rainfallMm, source) {
    const result = await pool.query(
      `INSERT INTO rainfall_data (location_id, date, rainfall_mm, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [locationId, date, rainfallMm, source]
    );
    return result.rows[0];
  }

  // Bulk insert cho Python script
  static async bulkInsert(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of data) {
        await client.query(
          `INSERT INTO rainfall_data (location_id, date, rainfall_mm, source)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [row.location_id, row.date, row.rainfall_mm, row.source]
        );
      }
      await client.query('COMMIT');
      return { success: true, count: data.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export default RainfallModel;