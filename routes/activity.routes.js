import express from 'express';
import ActivityController from '../controllers/activity.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// Tất cả routes đều cần authentication
router.use(authenticateToken);

router.post('/log', ActivityController.logActivity);
router.get('/history', ActivityController.getHistory);
router.get('/stats', ActivityController.getStats);

export default router;