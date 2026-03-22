const crypto = require('crypto');

/**
 * Admin/ops auth (current model):
 * - Bearer token stored in browser localStorage (XSS can steal it — prefer future httpOnly cookie migration).
 * - Short TTL + ADMIN_TOKEN_VERSION allow rotation without changing ADMIN_JWT_SECRET.
 */

// JWT-like token creation and verification using Node.js crypto
const createToken = (payload, secret) => {
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadBase64).digest('hex');
  return `${payloadBase64}.${signature}`;
};

const verifyToken = (token, secret) => {
  try {
    const [payloadBase64, signature] = token.split('.');
    if (!payloadBase64 || !signature) return null;
    
    const computedSignature = crypto.createHmac('sha256', secret).update(payloadBase64).digest('hex');
    
    // Use constant-time comparison for security
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(computedSignature, 'hex'))) {
      return null;
    }
    
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());

    const expectedTv = process.env.ADMIN_TOKEN_VERSION || '1';
    const tokenTv = payload.tv != null ? String(payload.tv) : '1';
    if (tokenTv !== expectedTv) {
      return null;
    }

    // Check expiration
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
};

// Middleware to protect admin routes
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access denied. No token provided.' 
    });
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer '
  const secret = process.env.ADMIN_JWT_SECRET || (process.env.NODE_ENV !== 'production' ? require('../config/defaults').adminJwtSecret : null);
  
  if (!secret) {
    console.error('ADMIN_JWT_SECRET not configured');
    return res.status(500).json({ 
      success: false, 
      message: 'Server configuration error' 
    });
  }
  
  const payload = verifyToken(token, secret);
  
  if (!payload || payload.sub !== 'admin') {
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }

  const role = payload.role === 'operator' ? 'operator' : 'admin';
  req.admin = payload;
  req.user = {
    id: payload.sub || 'admin',
    role
  };
  next();
};

module.exports = {
  createToken,
  verifyToken,
  adminAuth
};

