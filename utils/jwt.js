import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '123456';
const JWT_EXPIRES_IN = '7d'; // Token hết hạn sau 7 ngày

export const generateToken = (userId, username, role) => {
  return jwt.sign(
    { userId, username, role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};