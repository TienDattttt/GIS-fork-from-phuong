import pool from "../config/db.js";

class LocationModel {
  // Lấy tất cả locations
  static async getAll() {
    const result = await pool.query(
      "SELECT id, name, province FROM locations ORDER BY name"
    );
    return result.rows;
  }

  // Lấy location theo ID
  static async getById(id) {
    const result = await pool.query(
      "SELECT * FROM locations WHERE id = $1",
      [id]
    );
    return result.rows[0];
  }

  // Tạo location mới
  static async create(name, province, geometry = null) {
    const result = await pool.query(
      `INSERT INTO locations (name, province, geometry) 
       VALUES ($1, $2, $3) RETURNING *`,
      [name, province, geometry]
    );
    return result.rows[0];
  }
}

export default LocationModel;