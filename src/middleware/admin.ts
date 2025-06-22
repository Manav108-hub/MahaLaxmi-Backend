import { NextFunction, Request, Response } from "express";
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 1. Define the structure of your user object that will be attached to the request
interface AuthUser {
  id: string; // Assuming 'id' is a string UUID from Prisma. Adjust if it's a number.
  name: string | null; // Assuming name can be null based on your schema
  username: string;
  isAdmin: boolean;
}

// 2. Extend the Express Request interface
// This tells TypeScript that the 'Request' object might have a 'user' property of type 'AuthUser'
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser; // Make it optional with '?', as it's not present on all requests
    }
  }
}

// Optional: Define a more specific type for the JWT payload
interface DecodedToken {
  userId: string; // Ensure this matches the key in your JWT payload
  // Add other properties if your JWT payload contains them (e.g., iat, exp)
}

export const adminAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'Access denied. No token provided.' });
      return;
    }

    // Explicitly cast the result of jwt.verify to your DecodedToken interface
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as DecodedToken;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, username: true, isAdmin: true }
    });

    if (!user || !user.isAdmin) {
      res.status(403).json({ error: 'Access denied. Admin privileges required.' });
      return;
    }

    // Now, `req.user = user;` will no longer cause a TypeScript error
    // because you've told TypeScript that the Request object can have a `user` property.
    req.user = user;
    next();
  } catch (error) {
    // Handle specific JWT errors for clearer responses
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid or expired token.' });
      return;
    } else if (error instanceof Error) { // Catch other general errors
      console.error("Authentication error:", error.message);
      res.status(500).json({ error: 'Internal server error.' });
      return;
    } else {
      console.error("Unknown authentication error:", error);
      res.status(500).json({ error: 'An unknown error occurred during authentication.' });
      return;
    }
  }
};