import ActivityLogModel from '../models/activityLog.model.js';

class ActivityController {
  // Log hoạt động mới
  static async logActivity(req, res) {
    try {
      const { activityType, page, details } = req.body;
      
      const log = await ActivityLogModel.create(
        req.user.id,
        activityType,
        page,
        details,
        req.ip,
        req.headers['user-agent']
      );

      res.status(201).json({ 
        message: 'Activity logged',
        log 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Lấy lịch sử hoạt động
  static async getHistory(req, res) {
    try {
      const { limit = 50, offset = 0 } = req.query;
      
      const activities = await ActivityLogModel.getByUserId(
        req.user.id,
        parseInt(limit),
        parseInt(offset)
      );

      res.json({ activities });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Lấy thống kê
  static async getStats(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate || new Date();
      
      const stats = await ActivityLogModel.getStats(req.user.id, start, end);
      const recent = await ActivityLogModel.getRecent(req.user.id, 10);

      res.json({ 
        stats,
        recentActivities: recent,
        period: { start, end }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default ActivityController;