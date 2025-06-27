import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { generateCsrfToken } from '../middleware/auth';

const prisma = new PrismaClient();

export const register = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, username, password, adminToken } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { username }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    let isAdmin = false;
    if (adminToken) {
      if (adminToken !== process.env.ADMIN_SECRET_TOKEN) {
        return res.status(400).json({ error: 'Invalid admin token' });
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

    const csrfToken = generateCsrfToken();
    const token = jwt.sign(
      { 
        userId: user.id, 
        isAdmin: user.isAdmin,
        csrfToken
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      message: 'User registered successfully',
      user,
      csrfToken
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const csrfToken = generateCsrfToken();
    const token = jwt.sign(
      { 
        userId: user.id, 
        isAdmin: user.isAdmin,
        csrfToken
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        isAdmin: user.isAdmin
      },
      csrfToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const logout = (req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ message: 'Logout successful' });
};

export const refreshToken = (req: Request, res: Response) => {
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const csrfToken = generateCsrfToken();
    
    const newToken = jwt.sign(
      { 
        userId: decoded.userId, 
        isAdmin: decoded.isAdmin,
        csrfToken
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.cookie('token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ csrfToken });
  } catch (err) {
    res.clearCookie('token');
    return res.status(401).json({ error: 'Invalid token' });
  }
};