// src/utils/helpers.ts
import bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginationResult<T> {
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Environment validation with proper typing
class EnvironmentConfig {
  private static _jwtSecret?: string;

  static get jwtSecret(): string {
    if (!this._jwtSecret) {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error("FATAL ERROR: JWT_SECRET is not defined in environment variables.");
        process.exit(1);
      }
      this._jwtSecret = secret;
    }
    return this._jwtSecret;
  }
}

export class Helpers {
  // Password utilities
  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  static async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  // JWT utilities with explicit typing
  static generateToken(
    payload: string | object | Buffer,
    expiresIn: jwt.SignOptions['expiresIn'] = '7d'
  ): string {
    const options: jwt.SignOptions = { expiresIn };
    return jwt.sign(payload, EnvironmentConfig.jwtSecret, options);
  }

  static verifyToken(token: string): string | jwt.JwtPayload {
    try {
      return jwt.verify(token, EnvironmentConfig.jwtSecret);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  // Alternative token verification with callback
  static verifyTokenAsync(token: string): Promise<string | jwt.JwtPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(token, EnvironmentConfig.jwtSecret, (err, decoded) => {
        if (err) reject(new Error('Invalid or expired token'));
        else resolve(decoded as string | jwt.JwtPayload);
      });
    });
  }

  // Pagination utilities
  static getPaginationOptions(page?: string, limit?: string): PaginationOptions {
    const pageNum = parseInt(page || '1', 10);
    const limitNum = parseInt(limit || '10', 10);

    return {
      page: Math.max(1, pageNum),
      limit: Math.min(50, Math.max(1, limitNum)),
    };
  }

  static formatPaginationResult<T>(
    data: T[],
    totalItems: number,
    options: PaginationOptions
  ): PaginationResult<T> {
    const totalPages = Math.ceil(totalItems / options.limit);

    return {
      data,
      pagination: {
        currentPage: options.page,
        totalPages,
        totalItems,
        hasNext: options.page < totalPages,
        hasPrev: options.page > 1,
      },
    };
  }

  // String utilities
  static generateRandomString(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  static capitalizeWords(str: string): string {
    return str.replace(/\b\w/g, l => l.toUpperCase());
  }

  // Date utilities
  static formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  }

  static formatDateTime(date: Date): string {
    return new Intl.DateTimeFormat('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  static getDateRange(days: number): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return { startDate, endDate };
  }

  // Number utilities
  static formatPrice(price: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(price);
  }

  static formatNumber(num: number): string {
    return new Intl.NumberFormat('en-IN').format(num);
  }

  // Array utilities
  static removeDuplicates<T>(array: T[]): T[] {
    return [...new Set(array)];
  }

  static chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  static groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((groups, item) => {
      const groupKey = String(item[key]);
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(item);
      return groups;
    }, {} as Record<string, T[]>);
  }

  // Validation utilities
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static isValidPhone(phone: string): boolean {
    const phoneRegex = /^[6-9]\d{9}$/;
    return phoneRegex.test(phone);
  }

  static isValidPincode(pincode: string): boolean {
    const pincodeRegex = /^[1-9][0-9]{5}$/;
    return pincodeRegex.test(pincode);
  }

  // File utilities
  static getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  static isImageFile(filename: string): boolean {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    return imageExtensions.includes(this.getFileExtension(filename));
  }

  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Error handling utilities
  static createError(message: string, statusCode: number = 400): Error {
    const error = new Error(message) as any;
    error.statusCode = statusCode;
    return error;
  }
}
