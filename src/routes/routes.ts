// routes/api.ts
import express, { Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { 
  register, 
  login, 
  logout,
  refreshToken,
  getCurrentUser
} from '../controller/authController';

declare module 'express-serve-static-core' {
  interface Request {
    session?: {
      csrfToken?: string;
      [key: string]: any;
    };
    csrfToken?: () => string;
    user?: {
      id: string;
      username: string;
      role: string;
      isAdmin: boolean;
      [key: string]: any;
    };
  }
}

import { 
  getUserProfile, 
  updateUserDetails,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserStats,
  downloadUsersCSV 
} from '../controller/userController';
import { 
  createCategory, 
  getCategories, 
  createProduct, 
  getProducts, 
  getProductById,
  updateProduct,
  getProductBySlug 
} from '../controller/productController';
import { 
  addToCart, 
  getCart, 
  updateCartItem, 
  removeFromCart,
  getSelectedCartItems   
} from '../controller/cartController';
import { 
  createPaymentSession,
  handlePhonePeCallback,
  verifyPaymentStatus,
  getUserOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus
} from '../controller/orderController';
import { auth, adminAuth } from '../middleware/auth';
import { upload } from '../config/s3';

const router = express.Router();

// Wrapper function to ensure Promise<void> return type
const asyncHandler = (fn: (req: Request, res: Response, next?: NextFunction) => Promise<any>) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };
};

// Authentication Routes
router.post('/register', [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('adminToken').optional()
], asyncHandler(register));

router.post('/login', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], asyncHandler(login));

router.post('/logout', asyncHandler(logout));
router.post('/refresh-token', asyncHandler(refreshToken));
router.get('/me', auth, asyncHandler(getCurrentUser));

// User Profile Routes
router.get('/profile', auth, asyncHandler(getUserProfile));

router.post('/user-details', [
  auth,
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('phone').optional().isMobilePhone('en-IN').withMessage('Invalid phone number'),
  body('address').optional().trim().isLength({ min: 10 }).withMessage('Address must be at least 10 characters'),
  body('city').optional().trim().notEmpty().withMessage('City is required'),
  body('state').optional().trim().notEmpty().withMessage('State is required'),
  body('pincode').optional().isPostalCode('IN').withMessage('Invalid pincode')
], asyncHandler(updateUserDetails));

// Category Routes
router.post('/category', [
  auth,
  adminAuth,
  body('name').trim().isLength({ min: 2 }).withMessage('Category name must be at least 2 characters'),
  body('description').optional().trim()
], asyncHandler(createCategory));

router.get('/categories', asyncHandler(getCategories));

// Product Routes
router.post(
  '/product',
  auth,
  adminAuth,
  upload.array('images', 5),
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Product name must be at least 2 characters'),
    body('description').optional().trim(),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('stock').isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
    body('categoryId').notEmpty().withMessage('Category ID is required')
  ],
  asyncHandler(createProduct)
);

router.get('/products', asyncHandler(getProducts));
router.get('/product/:id', asyncHandler(getProductById));
router.get('/products/slug/:slug', asyncHandler(getProductBySlug));

router.put(
  '/product/:id',
  auth,
  adminAuth,
  upload.array('images', 5),
  [
    body('name').optional().trim(),
    body('description').optional().trim(),
    body('price').optional().isFloat({ min: 0 }),
    body('stock').optional().isInt({ min: 0 }),
    body('categoryId').optional().notEmpty()
  ],
  asyncHandler(updateProduct)
);

// Cart Routes
router.post('/cart', [
  auth,
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], asyncHandler(addToCart));

router.get('/cart', auth, asyncHandler(getCart));

router.put('/cart/:itemId', [
  auth,
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], asyncHandler(updateCartItem));

router.delete('/cart/:itemId', auth, asyncHandler(removeFromCart));

router.post('/cart/selected', [
  auth,
  body('cartItemIds').isArray({ min: 1 }).withMessage('At least one cart item must be selected'),
  body('cartItemIds.*').isString().withMessage('Invalid cart item ID format')
], asyncHandler(getSelectedCartItems));

// NEW PAYMENT-FIRST ORDER FLOW
// Step 1: Create payment session (replaces direct order creation)
router.post('/payment/create-session', [
  auth,
  body('shippingAddress').isObject().withMessage('Shipping address is required'),
  body('shippingAddress.name').trim().notEmpty().withMessage('Recipient name is required'),
  body('shippingAddress.phone').isMobilePhone('en-IN').withMessage('Valid phone number is required'),
  body('shippingAddress.address').trim().isLength({ min: 10 }).withMessage('Address must be at least 10 characters'),
  body('shippingAddress.city').trim().notEmpty().withMessage('City is required'),
  body('shippingAddress.state').trim().notEmpty().withMessage('State is required'),
  body('shippingAddress.pincode').isPostalCode('IN').withMessage('Valid pincode is required'),
  body('cartItemIds').isArray({ min: 1 }).withMessage('At least one cart item must be selected'),
  body('cartItemIds.*').isString().withMessage('Invalid cart item ID format')
], asyncHandler(createPaymentSession));

// Step 2: PhonePe callback handler (webhook)
router.post('/payment/phonepe/callback', asyncHandler(handlePhonePeCallback));

// Step 3: Verify payment status
router.get('/payment/status/:transactionId', auth, asyncHandler(verifyPaymentStatus));

// Order Routes (only for viewing orders after payment)
router.get('/orders', auth, asyncHandler(getUserOrders));
router.get('/order/:id', auth, asyncHandler(getOrderById));

// Admin Order Routes
router.get('/admin/orders', auth, adminAuth, asyncHandler(getAllOrders));

// Admin User Management Routes
router.get('/users', auth, adminAuth, asyncHandler(getAllUsers));
router.get('/user/:id', auth, adminAuth, asyncHandler(getUserById));
router.put('/user/:id', [
  auth,
  adminAuth,
  body('name').optional().trim().isLength({ min: 2 }),
  body('username').optional().trim().isLength({ min: 3 }),
  body('email').optional().isEmail(),
  body('phone').optional().isMobilePhone('en-IN'),
  body('isAdmin').optional().isBoolean()
], asyncHandler(updateUser));
router.delete('/user/:id', auth, adminAuth, asyncHandler(deleteUser));
router.get('/user/:id/stats', auth, adminAuth, asyncHandler(getUserStats));
router.get('/users/download', auth, adminAuth, asyncHandler(downloadUsersCSV));

router.put('/admin/order/:id/status', [
  auth,
  adminAuth,
  body('deliveryStatus').optional().isIn(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED']),
  body('paymentStatus').optional().isIn(['PENDING', 'PAID', 'FAILED', 'REFUNDED'])
], asyncHandler(updateOrderStatus));

// Health check endpoint
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    paymentGateway: 'PhonePe'
  });
}));

export default router;