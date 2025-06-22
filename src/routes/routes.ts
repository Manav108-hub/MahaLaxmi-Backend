// src/routes/routes.ts
import express, { Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { register, login } from '../controller/authController';
import { getUserProfile, updateUserDetails, downloadUsersCSV } from '../controller/userController';
import { 
  createCategory, 
  getCategories, 
  createProduct, 
  getProducts, 
  getProductById,
  updateProduct 
} from '../controller/productController';
import { 
  addToCart, 
  getCart, 
  updateCartItem, 
  removeFromCart 
} from '../controller/cartController';
import { 
  createOrder, 
  getOrderById, 
  getUserOrders,
  getAllOrders,
  updateOrderStatus,
  initiatePayment,
  verifyPayment
} from '../controller/orderController';
import { auth } from '../middleware/auth';
import { adminAuth } from '../middleware/admin';
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

// Middleware wrapper to ensure Promise<void> return type
const middlewareHandler = (fn: (req: any, res: Response, next: NextFunction) => Promise<any>) => {
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

// User Routes
router.get('/profile', middlewareHandler(auth), asyncHandler(getUserProfile));

router.post('/user-details', [
  middlewareHandler(auth),
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('phone').optional().isMobilePhone('en-IN').withMessage('Invalid phone number'),
  body('address').optional().trim().isLength({ min: 10 }).withMessage('Address must be at least 10 characters'),
  body('city').optional().trim().notEmpty().withMessage('City is required'),
  body('state').optional().trim().notEmpty().withMessage('State is required'),
  body('pincode').optional().isPostalCode('IN').withMessage('Invalid pincode')
], asyncHandler(updateUserDetails));

// Admin Routes
router.get('/users/download', middlewareHandler(adminAuth), asyncHandler(downloadUsersCSV));

// Category Routes
router.post('/category', [
  middlewareHandler(adminAuth),
  body('name').trim().isLength({ min: 2 }).withMessage('Category name must be at least 2 characters'),
  body('description').optional().trim()
], asyncHandler(createCategory));

router.get('/categories', asyncHandler(getCategories));

// Product Routes
router.post('/product', 
  middlewareHandler(adminAuth),
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

router.put('/product/:id',
  middlewareHandler(adminAuth),
  upload.array('images', 5),
  asyncHandler(updateProduct)
);

// Cart Routes
router.post('/cart', [
  middlewareHandler(auth),
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], asyncHandler(addToCart));

router.get('/cart', middlewareHandler(auth), asyncHandler(getCart));

router.put('/cart/:itemId', [
  middlewareHandler(auth),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], asyncHandler(updateCartItem));

router.delete('/cart/:itemId', middlewareHandler(auth), asyncHandler(removeFromCart));

// Order Routes
router.post('/order', [
  middlewareHandler(auth),
  body('paymentMethod').isIn(['COD', 'ONLINE']).withMessage('Invalid payment method'),
  body('shippingAddress').isObject().withMessage('Shipping address is required')
], asyncHandler(createOrder));

router.get('/orders', middlewareHandler(auth), asyncHandler(getUserOrders));
router.get('/order/:id', middlewareHandler(auth), asyncHandler(getOrderById));

// Admin Order Routes
router.get('/admin/orders', middlewareHandler(adminAuth), asyncHandler(getAllOrders));

router.put('/admin/order/:id/status', [
  middlewareHandler(adminAuth),
  body('deliveryStatus').optional().isIn(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED']),
  body('paymentStatus').optional().isIn(['PENDING', 'PAID', 'FAILED', 'REFUNDED'])
], asyncHandler(updateOrderStatus));

// Payment Routes
router.post('/payment/initiate', middlewareHandler(auth), asyncHandler(initiatePayment));
router.post('/payment/verify', middlewareHandler(auth), asyncHandler(verifyPayment));

export default router;