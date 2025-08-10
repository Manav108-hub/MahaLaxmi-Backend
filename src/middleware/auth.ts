import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extended Request interface for TypeScript
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        role: string;
        isAdmin: boolean;
      };
    }
  }
}

// Authentication middleware
export const auth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.cookies.accessToken;

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token required'
      });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Fetch user from database to ensure they still exist
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, username: true, isAdmin: true }
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.isAdmin ? 'admin' : 'user',
      isAdmin: user.isAdmin
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

// Admin authentication middleware
export const adminAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
    return;
  }

  next();
};

// CSRF Protection - ONLY for critical admin operations like admin user creation
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  // Skip CSRF for GET requests
  if (req.method === 'GET') {
    return next();
  }

  // Only apply CSRF protection for admin user creation
  const isAdminCreation = req.path.includes('/admin/create-user') || 
                         (req.path.includes('/register') && req.body.adminToken);

  if (!isAdminCreation) {
    // Skip CSRF for regular operations
    return next();
  }

  try {
    // Get CSRF token from various sources
    const token = req.headers['x-csrf-token'] || 
                  req.headers['x-xsrf-token'] || 
                  req.headers['csrf-token'] || 
                  req.body._csrf ||
                  req.query._csrf;

    const cookieToken = req.cookies['XSRF-TOKEN'];

    if (!token && !cookieToken) {
      res.status(403).json({
        success: false,
        error: 'CSRF token required for admin operations'
      });
      return;
    }

    // Simple token validation (for admin operations only)
    if (token && cookieToken && token === cookieToken) {
      return next();
    }

    // Allow if just the environment token is used (development)
    if (token === process.env.CSRF_TOKEN) {
      return next();
    }

    res.status(403).json({
      success: false,
      error: 'Invalid CSRF token for admin operation'
    });
  } catch (error) {
    console.error('CSRF protection error:', error);
    res.status(500).json({
      success: false,
      error: 'CSRF validation error'
    });
  }
};

// Rate limiting middleware (optional - for API protection without CSRF)
export const rateLimiter = (windowMs: number = 15 * 60 * 1000, maxRequests: number = 100) => {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    const clientData = requestCounts.get(clientId);
    
    if (!clientData || now > clientData.resetTime) {
      requestCounts.set(clientId, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    if (clientData.count >= maxRequests) {
      res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
      return;
    }
    
    clientData.count++;
    next();
  };
};

// Optional: Input sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  const sanitize = (obj: any): any => {
    if (typeof obj === 'string') {
      return obj.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    if (typeof obj === 'object' && obj !== null) {
      const sanitized: any = Array.isArray(obj) ? [] : {};
      for (const key in obj) {
        sanitized[key] = sanitize(obj[key]);
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitize(req.body);
  }
  if (req.query) {
    req.query = sanitize(req.query);
  }
  if (req.params) {
    req.params = sanitize(req.params);
  }

  next();
};