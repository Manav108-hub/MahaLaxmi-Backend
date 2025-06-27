import express, { Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { 
  register, 
  login, 
  logout,
  refreshToken
} from '../controller/authController';
import { 
  getUserProfile, 
  updateUserDetails, 
  downloadUsersCSV 
} from '../controller/userController';
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
  removeFromCart,
  getSelectedCartItems   
} from '../controller/cartController';
import { 
  createOrder, 
  getOrderById, 
  getUserOrders,
  getAllOrders,
  updateOrderStatus,
  initiatePayment,
  verifyPayment,
  getPaymentDetails
} from '../controller/orderController';
import { auth, adminAuth, csrfProtection } from '../middleware/auth';
import { upload } from '../config/s3';
import { mockPaymentService } from '../services/paymentService';

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

// Protected Routes
router.get('/profile', auth, asyncHandler(getUserProfile));

router.post('/user-details', [
  auth,
  csrfProtection,
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('phone').optional().isMobilePhone('en-IN').withMessage('Invalid phone number'),
  body('address').optional().trim().isLength({ min: 10 }).withMessage('Address must be at least 10 characters'),
  body('city').optional().trim().notEmpty().withMessage('City is required'),
  body('state').optional().trim().notEmpty().withMessage('State is required'),
  body('pincode').optional().isPostalCode('IN').withMessage('Invalid pincode')
], asyncHandler(updateUserDetails));

// Admin Routes
router.get('/users/download', auth, adminAuth, asyncHandler(downloadUsersCSV));

// Category Routes
router.post('/category', [
  auth,
  adminAuth,
  csrfProtection,
  body('name').trim().isLength({ min: 2 }).withMessage('Category name must be at least 2 characters'),
  body('description').optional().trim()
], asyncHandler(createCategory));

router.get('/categories', asyncHandler(getCategories));

// Product Routes
router.post(
  '/product',
  auth,
  adminAuth,
  csrfProtection,
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

router.put(
  '/product/:id',
  auth,
  adminAuth,
  csrfProtection,
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
  csrfProtection,
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], asyncHandler(addToCart));

router.get('/cart', auth, asyncHandler(getCart));

router.put('/cart/:itemId', [
  auth,
  csrfProtection,
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], asyncHandler(updateCartItem));

router.delete('/cart/:itemId', auth, csrfProtection, asyncHandler(removeFromCart));

router.post('/cart/selected', [
  auth,
  csrfProtection,
  body('cartItemIds').isArray({ min: 1 }).withMessage('At least one cart item must be selected'),
  body('cartItemIds.*').isString().withMessage('Invalid cart item ID format')
], asyncHandler(getSelectedCartItems));

// Order Routes
router.post('/order', [
  auth,
  csrfProtection,
  body('paymentMethod').isIn(['COD', 'ONLINE']).withMessage('Invalid payment method'),
  body('shippingAddress').isObject().withMessage('Shipping address is required'),
  body('cartItemIds').isArray({ min: 1 }).withMessage('At least one cart item must be selected'),
  body('cartItemIds.*').isString().withMessage('Invalid cart item ID format')
], asyncHandler(createOrder));

router.get('/orders', auth, asyncHandler(getUserOrders));
router.get('/order/:id', auth, asyncHandler(getOrderById));

// Payment Routes for Orders
router.post('/order/payment/initiate', [
  auth,
  csrfProtection,
  body('orderId').notEmpty().withMessage('Order ID is required')
], asyncHandler(initiatePayment));

router.post('/order/payment/verify', [
  auth,
  csrfProtection,
  body('transactionId').notEmpty().withMessage('Transaction ID is required')
], asyncHandler(verifyPayment));

router.get('/order/:orderId/payments', auth, asyncHandler(getPaymentDetails));

// Admin Order Routes
router.get('/admin/orders', auth, adminAuth, asyncHandler(getAllOrders));

router.put('/admin/order/:id/status', [
  auth,
  adminAuth,
  csrfProtection,
  body('deliveryStatus').optional().isIn(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED']),
  body('paymentStatus').optional().isIn(['PENDING', 'PAID', 'FAILED', 'REFUNDED'])
], asyncHandler(updateOrderStatus));

// Mock Payment Routes
router.post('/payment/initiate', [
  auth,
  csrfProtection,
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('callbackUrl').isURL().withMessage('Valid callback URL is required'),
  body('mobileNumber').optional().isMobilePhone('en-IN').withMessage('Invalid mobile number')
], asyncHandler(async (req: Request, res: Response) => {
  const { orderId, amount, callbackUrl, mobileNumber } = req.body;
  const userId = req.user!.id;

  try {
    const paymentRequest = {
      merchantTransactionId: orderId,
      merchantUserId: userId.toString(),
      amount: parseFloat(amount),
      callbackUrl,
      mobileNumber
    };

    const paymentResponse = await mockPaymentService.initiatePayment(paymentRequest);

    if (paymentResponse.success) {
      res.status(200).json({
        success: true,
        message: 'Payment initiated successfully',
        data: {
          paymentUrl: paymentResponse.paymentUrl,
          transactionId: paymentResponse.transactionId
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: paymentResponse.error || 'Payment initiation failed'
      });
    }
  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}));

router.get('/payment/status/:transactionId', auth, asyncHandler(async (req: Request, res: Response) => {
  const { transactionId } = req.params;

  try {
    const paymentStatus = await mockPaymentService.checkPaymentStatus(transactionId);

    res.status(200).json({
      success: true,
      data: paymentStatus
    });
  } catch (error) {
    console.error('Payment status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}));

router.post('/payment/complete/:transactionId', [
  auth,
  csrfProtection,
  body('success').isBoolean().withMessage('Success status is required')
], asyncHandler(async (req: Request, res: Response) => {
  const { transactionId } = req.params;
  const { success } = req.body;

  try {
    const completed = await mockPaymentService.completePayment(transactionId, success);

    if (completed) {
      res.status(200).json({
        success: true,
        message: `Payment ${success ? 'completed' : 'failed'} successfully`
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
  } catch (error) {
    console.error('Payment completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}));

// Mock payment callback handler
router.get('/mock-payment', asyncHandler(async (req, res) => {
  const { txn, amt, callback } = req.query;
  if (!txn || !amt || !callback) {
    return res.status(400).send('Missing required parameters');
  }

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mock Payment Gateway</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .payment-card {
          max-width: 400px;
          margin: 40px auto;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }
        .amount { font-size: 2rem; color: #2563eb; margin: 20px 0; }
        .buttons { display: flex; justify-content: space-around; margin-top: 20px; }
        button {
          flex: 1;
          margin: 0 5px;
          padding: 12px 0;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          cursor: pointer;
        }
        .success { background-color: #16a34a; color: white; }
        .failure { background-color: #dc2626; color: white; }
      </style>
    </head>
    <body>
      <div class="payment-card">
        <h2>Mock Payment Gateway</h2>
        <p><strong>Transaction ID:</strong> ${txn}</p>
        <p><strong>Amount:</strong> ₹${amt}</p>
        <div class="amount">₹${amt}</div>
        <div class="buttons">
          <button class="success" onclick="completePayment(true)">Success</button>
          <button class="failure" onclick="completePayment(false)">Failure</button>
        </div>
      </div>

      <script>
        async function completePayment(success) {
          try {
            const resp = await fetch(window.location.origin + '/api/payment/complete/${txn}', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ success })
            });
            if (!resp.ok) throw new Error('Network response was not ok');
            const status = success ? 'SUCCESS' : 'FAILURE';
            window.location.href = '${callback}?status=' + status + '&txn=${txn}';
          } catch (err) {
            alert('Error completing payment: ' + err.message);
          }
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
}));

// Admin route to view payment sessions
router.get('/admin/payments', auth, adminAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const sessions = mockPaymentService.getPaymentSessions();
    res.status(200).json({
      success: true,
      data: sessions
    });
  } catch (error) {
    console.error('Get payment sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}));

export default router;