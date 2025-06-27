import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

interface AuthUser {
  id: string;
  name: string | null;
  username: string;
  isAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      csrfToken?: string;
    }
  }
}

export const auth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.cookies.token;
   
    if (!token) {
      res.status(401).json({ error: 'Access denied. No token provided.' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
   
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, username: true, isAdmin: true }
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid token.' });
      return;
    }

    req.user = user;
    req.csrfToken = decoded.csrfToken;
    next();
  } catch (error) {
    res.clearCookie('token');
   
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired.' });
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token.' });
    } else {
      console.error('Authentication error:', error);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
};

export const adminAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    return;
  }
  next();
};

export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const csrfToken = req.headers['x-csrf-token'];
   
    if (!csrfToken || csrfToken !== req.csrfToken) {
      res.status(403).json({ error: 'Invalid CSRF token' });
      return;
    }
  }
  next();
};

export const generateCsrfToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};