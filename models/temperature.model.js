import pool from "../config/db.js";

class TemperatureModel {
  static async getByDateRange(locationId, startDate, endDate) {
    const result = await pool.query(
      `SELECT date, temp_min, temp_max, temp_mean, source 
       FROM temperature_data
       WHERE location_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date ASC`,
      [locationId, startDate, endDate]
    );
    return result.rows;
  }

  static async getMonthlyStats(locationId, year) {
    const result = await pool.query(
      `SELECT 
        EXTRACT(MONTH FROM date) as month,
        AVG(temp_mean) as avg_temp,
        AVG(temp_min) as avg_min,
        AVG(temp_max) as avg_max,
        MIN(temp_min) as min_temp,
        MAX(temp_max) as max_temp
       FROM temperature_data
       WHERE location_id = $1 
         AND EXTRACT(YEAR FROM date) = $2
       GROUP BY EXTRACT(MONTH FROM date)
       ORDER BY month`,
      [locationId, year]
    );
    return result.rows;
  }

  static async create(locationId, date, tempMin, tempMax, tempMean, source) {
    const result = await pool.query(
      `INSERT INTO temperature_data (location_id, date, temp_min, temp_max, temp_mean, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [locationId, date, tempMin, tempMax, tempMean, source]
    );
    return result.rows[0];
  }
}

export default TemperatureModel;