import UserModel from '../models/user.model.js';
import ActivityLogModel from '../models/activityLog.model.js';
import { generateToken } from '../utils/jwt.js';

class AuthController {
  // Đăng ký
  static async register(req, res) {
    try {
      const { username, email, password, fullName } = req.body;

      // Validation
      if (!username || !email || !password) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          required: ['username', 'email', 'password']
        });
      }

      // Kiểm tra username đã tồn tại
      const existingUser = await UserModel.findByUsername(username);
      if (existingUser) {
        return res.status(409).json({ 
          error: 'Username already exists' 
        });
      }

      // Kiểm tra email đã tồn tại
      const existingEmail = await UserModel.findByEmail(email);
      if (existingEmail) {
        return res.status(409).json({ 
          error: 'Email already exists' 
        });
      }

      // Tạo user mới
      const user = await UserModel.create(username, email, password, fullName);

      // Tạo token
      const token = generateToken(user.id, user.username, user.role);

      // Log activity
      await ActivityLogModel.create(
        user.id,
        'register',
        'auth',
        { username: user.username },
        req.ip,
        req.headers['user-agent']
      );

      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.full_name,
          role: user.role
        }
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Registration failed', 
        message: error.message 
      });
    }
  }

  // Đăng nhập
  static async login(req, res) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ 
          error: 'Username and password required' 
        });
      }

      // Tìm user
      const user = await UserModel.findByUsername(username);
      
      if (!user) {
        return res.status(401).json({ 
          error: 'Invalid credentials' 
        });
      }

      // Verify password
      const isValidPassword = await UserModel.verifyPassword(
        password, 
        user.password_hash
      );

      if (!isValidPassword) {
        return res.status(401).json({ 
          error: 'Invalid credentials' 
        });
      }

      // Cập nhật last login
      await UserModel.updateLastLogin(user.id);

      // Tạo token
      const token = generateToken(user.id, user.username, user.role);

      // Log activity
      await ActivityLogModel.create(
        user.id,
        'login',
        'auth',
        { username: user.username },
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.full_name,
          role: user.role
        }
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Login failed', 
        message: error.message 
      });
    }
  }

  // Đăng xuất
  static async logout(req, res) {
    try {
      // Log activity
      if (req.user) {
        await ActivityLogModel.create(
          req.user.id,
          'logout',
          'auth',
          { username: req.user.username },
          req.ip,
          req.headers['user-agent']
        );
      }

      res.json({ message: 'Logout successful' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Lấy thông tin user hiện tại
  static async getCurrentUser(req, res) {
    try {
      res.json({
        user: {
          id: req.user.id,
          username: req.user.username,
          email: req.user.email,
          fullName: req.user.full_name,
          role: req.user.role,
          createdAt: req.user.created_at,
          lastLogin: req.user.last_login
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default AuthController;
