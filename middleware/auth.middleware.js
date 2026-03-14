import { verifyToken } from '../utils/jwt.js';
import UserModel from '../models/user.model.js';

// Middleware kiểm tra authentication
export const authenticateToken = async (req, res, next) => {
  try {
    // Lấy token từ header hoặc cookie
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No token provided' 
      });
    }

    // Verify token
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid or expired token' 
      });
    }

    // Lấy thông tin user
    const user = await UserModel.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'User not found' 
      });
    }

    // Gắn user vào request
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication error', message: error.message });
  }
};

// Middleware kiểm tra role admin
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Admin access required' 
    });
  }
  next();
};

// Middleware optional auth (không bắt buộc login)
export const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
    
    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        const user = await UserModel.findById(decoded.userId);
        if (user) {
          req.user = user;
        }
      }
    }
    next();
  } catch (error) {
    next();
  }
};