import pool from "../config/db.js";
import bcrypt from "bcryptjs";

class UserModel {
  // Tạo user mới
  static async create(username, email, password, fullName) {
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4) RETURNING id, username, email, full_name, role, created_at`,
      [username, email, passwordHash, fullName]
    );
    
    return result.rows[0];
  }

  // Tìm user theo username
  static async findByUsername(username) {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );
    return result.rows[0];
  }

  // Tìm user theo email
  static async findByEmail(email) {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );
    return result.rows[0];
  }

  // Tìm user theo ID
  static async findById(id) {
    const result = await pool.query(
      'SELECT id, username, email, full_name, role, created_at, last_login FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  // Verify password
  static async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  // Cập nhật last login
  static async updateLastLogin(userId) {
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );
  }

  // Lấy tất cả users (cho admin)
  static async getAll() {
    const result = await pool.query(
      'SELECT id, username, email, full_name, role, created_at, last_login FROM users ORDER BY created_at DESC'
    );
    return result.rows;
  }
}

export default UserModel;