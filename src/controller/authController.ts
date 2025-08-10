import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
      return;
    }

    const { name, username, password, adminToken } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { username }
    });

    if (existingUser) {
      res.status(400).json({ 
        success: false,
        error: 'User already exists' 
      });
      return;
    }

    let isAdmin = false;
    if (adminToken) {
      if (adminToken !== process.env.ADMIN_SECRET_TOKEN) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid admin token' 
        });
        return;
      }
      isAdmin = true;
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = await prisma.user.create({
      data: {
        name,
        username,
        password: hashedPassword,
        isAdmin
      },
      select: {
        id: true,
        name: true,
        username: true,
        isAdmin: true,
        createdAt: true
      }
    });

    // Generate JWT without CSRF token
    const accessToken = jwt.sign(
      { 
        userId: user.id, 
        isAdmin: user.isAdmin,
        username: user.username
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // Set HTTP-only cookie for security
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
      return;
    }

    const { username, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      res.status(400).json({ 
        success: false,
        error: 'Invalid credentials' 
      });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      res.status(400).json({ 
        success: false,
        error: 'Invalid credentials' 
      });
      return;
    }

    // Generate JWT without CSRF token
    const accessToken = jwt.sign(
      { 
        userId: user.id, 
        isAdmin: user.isAdmin,
        username: user.username
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // Set HTTP-only cookie for security
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    // Clear the access token cookie
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    res.json({ 
      success: true,
      message: 'Logout successful' 
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies.accessToken;
  
  if (!token) {
    res.status(401).json({ 
      success: false,
      error: 'Authentication required' 
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Verify user still exists in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, username: true, isAdmin: true }
    });

    if (!user) {
      res.clearCookie('accessToken');
      res.status(401).json({ 
        success: false,
        error: 'User not found' 
      });
      return;
    }

    // Generate new JWT without CSRF token
    const newAccessToken = jwt.sign(
      { 
        userId: user.id, 
        isAdmin: user.isAdmin,
        username: user.username
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // Set new cookie
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({ 
      success: true,
      message: 'Token refreshed successfully',
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin
      }
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.clearCookie('accessToken');
    res.status(401).json({ 
      success: false,
      error: 'Invalid token' 
    });
  }
};

// Get current user info (useful for frontend)
export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
      return;
    }

    // Fetch fresh user data from database
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        username: true,
        isAdmin: true,
        createdAt: true
      }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};