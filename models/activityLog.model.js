import pool from "../config/db.js";

class ActivityLogModel {
  // Tạo log mới
  static async create(userId, activityType, page, details, ipAddress, userAgent) {
    const result = await pool.query(
      `INSERT INTO user_activity_logs 
       (user_id, activity_type, page, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, activityType, page, JSON.stringify(details), ipAddress, userAgent]
    );
    return result.rows[0];
  }

  // Lấy lịch sử của user
  static async getByUserId(userId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM user_activity_logs 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }

  // Lấy thống kê hoạt động
  static async getStats(userId, startDate, endDate) {
    const result = await pool.query(
      `SELECT 
         activity_type,
         COUNT(*) as count,
         MIN(created_at) as first_activity,
         MAX(created_at) as last_activity
       FROM user_activity_logs
       WHERE user_id = $1 
         AND created_at BETWEEN $2 AND $3
       GROUP BY activity_type
       ORDER BY count DESC`,
      [userId, startDate, endDate]
    );
    return result.rows;
  }

  // Lấy hoạt động gần đây nhất
  static async getRecent(userId, limit = 10) {
    const result = await pool.query(
      `SELECT activity_type, page, details, created_at 
       FROM user_activity_logs 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }
}

export default ActivityLogModel;