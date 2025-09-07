// controller/orderController.ts - Updated for MongoDB
import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { emailService } from '../services/emailService';
import { phonePeService } from '../services/paymentService';

const prisma = new PrismaClient();

// Create payment session (replaces createOrder)
export const createPaymentSession = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { shippingAddress, cartItemIds } = req.body;
    const userId = req.user!.id;

    // Validate user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userDetails: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate shipping address
    const requiredFields = ['name', 'phone', 'address', 'city', 'state', 'pincode'];
    for (const field of requiredFields) {
      if (!shippingAddress[field]) {
        return res.status(400).json({ error: `${field} is required in shipping address` });
      }
    }

    // Validate cart items - MongoDB uses string IDs
    const cartItems = await prisma.cart.findMany({
      where: { 
        userId, 
        id: { in: cartItemIds }
      },
      include: { product: true }
    });

    if (cartItems.length !== cartItemIds.length) {
      return res.status(400).json({ error: 'Some selected items are not in your cart' });
    }

    // Check product availability
    const inactive = cartItems.filter(i => !i.product.isActive);
    if (inactive.length) {
      return res.status(400).json({
        error: `Unavailable products: ${inactive.map(i => i.product.name).join(', ')}`
      });
    }

    // Check stock
    for (const item of cartItems) {
      if (item.product.stock < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for ${item.product.name}. Available: ${item.product.stock}, Required: ${item.quantity}`
        });
      }
    }

    const totalAmount = cartItems.reduce(
      (sum, item) => sum + (item.product.price * item.quantity), 
      0
    );

    // Generate transaction ID
    const transactionId = phonePeService.generateTransactionId();

    // Create payment session record
    const paymentSession = await prisma.paymentSession.create({
      data: {
        transactionId,
        userId,
        amount: totalAmount,
        cartItemIds,
        shippingAddress,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes expiry
      }
    });

    // Initiate PhonePe payment
    const paymentResponse = await phonePeService.initiatePayment(
      transactionId,
      totalAmount,
      userId,
      shippingAddress.phone
    );

    if (!paymentResponse.success) {
      await prisma.paymentSession.update({
        where: { id: paymentSession.id },
        data: { status: 'FAILED' }
      });

      return res.status(400).json({
        error: 'Payment initiation failed',
        details: paymentResponse.message
      });
    }

    // Update payment session with payment URL
    await prisma.paymentSession.update({
      where: { id: paymentSession.id },
      data: {
        paymentUrl: paymentResponse.data?.instrumentResponse.redirectInfo.url,
        phonePeResponse: paymentResponse as any
      }
    });

    res.status(201).json({
      message: 'Payment session created successfully',
      paymentSession: {
        id: paymentSession.id,
        transactionId,
        amount: totalAmount,
        paymentUrl: paymentResponse.data?.instrumentResponse.redirectInfo.url,
        expiresAt: paymentSession.expiresAt
      },
      orderSummary: {
        itemsCount: cartItems.length,
        totalAmount: totalAmount,
        items: cartItems.map(item => ({
          productName: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
          total: item.product.price * item.quantity
        }))
      }
    });
  } catch (error) {
    console.error('Create payment session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PhonePe callback handler
export const handlePhonePeCallback = async (req: Request, res: Response) => {
  try {
    const { response } = req.body;
    const checksum = req.headers['x-verify'] as string;

    if (!response || !checksum) {
      return res.status(400).json({ error: 'Missing response or checksum' });
    }

    // Verify callback authenticity
    if (!phonePeService.verifyCallback(response, checksum)) {
      console.error('Invalid callback checksum');
      return res.status(400).json({ error: 'Invalid callback' });
    }

    // Decode response
    const callbackData = phonePeService.decodeCallbackResponse(response);
    const { merchantTransactionId, transactionId, amount, state, responseCode } = callbackData.data;

    // Find payment session
    const paymentSession = await prisma.paymentSession.findUnique({
      where: { transactionId: merchantTransactionId },
      include: {
        user: {
          include: { userDetails: true }
        }
      }
    });

    if (!paymentSession) {
      console.error('Payment session not found:', merchantTransactionId);
      return res.status(404).json({ error: 'Payment session not found' });
    }

    // Update payment session
    await prisma.paymentSession.update({
      where: { id: paymentSession.id },
      data: {
        status: state === 'COMPLETED' ? 'SUCCESS' : 'FAILED',
        phonePeTransactionId: transactionId,
        completedAt: state === 'COMPLETED' ? new Date() : null,
        callbackData: callbackData as any
      }
    });

    if (state === 'COMPLETED') {
      // Create the actual order
      await createOrderFromPaymentSession(paymentSession);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('PhonePe callback error:', error);
    res.status(500).json({ error: 'Callback processing failed' });
  }
};

// Helper function to create order from successful payment
async function createOrderFromPaymentSession(paymentSession: any) {
  try {
    // Get cart items
    const cartItems = await prisma.cart.findMany({
      where: { 
        userId: paymentSession.userId,
        id: { in: paymentSession.cartItemIds }
      },
      include: { product: true }
    });

    // Create order in transaction - MongoDB doesn't support nested transactions like PostgreSQL
    // We'll use a manual transaction approach
    let orderId: string;
    
    try {
      // Create order
      const order = await prisma.order.create({
        data: {
          userId: paymentSession.userId,
          totalAmount: paymentSession.amount,
          paymentMethod: 'ONLINE',
          paymentStatus: 'PAID',
          paymentId: paymentSession.phonePeTransactionId,
          shippingAddress: paymentSession.shippingAddress,
          deliveryStatus: 'CONFIRMED'
        }
      });
      
      orderId = order.id;

      // Create order items
      const orderItemsData = cartItems.map(item => ({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        price: item.product.price
      }));

      await prisma.orderItem.createMany({
        data: orderItemsData
      });

      // Update product stock - MongoDB requires individual updates
      for (const item of cartItems) {
        await prisma.product.update({
          where: { id: item.productId },
          data: { 
            stock: {
              decrement: item.quantity
            }
          }
        });
      }

      // Remove cart items
      await prisma.cart.deleteMany({
        where: { 
          userId: paymentSession.userId,
          id: { in: paymentSession.cartItemIds }
        }
      });

      // Update payment session with order ID
      await prisma.paymentSession.update({
        where: { id: paymentSession.id },
        data: { orderId: order.id }
      });

    } catch (error) {
      // If any step fails, we should ideally rollback
      // For MongoDB, we need to handle this manually
      console.error('Error in order creation process:', error);
      
      // Mark payment session as failed if order creation fails
      await prisma.paymentSession.update({
        where: { id: paymentSession.id },
        data: { status: 'FAILED' }
      });
      
      throw error;
    }

    // Send confirmation emails
    try {
      const completeOrder = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          orderItems: {
            include: { product: true }
          },
          user: {
            include: { userDetails: true }
          }
        }
      });

      if (completeOrder) {
        await emailService.sendOrderConfirmation(
          completeOrder.user.userDetails?.email ?? 'admin@yourdomain.com',
          completeOrder.user.name || completeOrder.user.username,
          completeOrder.id,
          completeOrder.totalAmount
        );
        await emailService.sendAdminOrderNotification(completeOrder);
      }
    } catch (emailError) {
      console.error('Email sending error:', emailError);
    }

    return orderId;
  } catch (error) {
    console.error('Error creating order from payment session:', error);
    throw error;
  }
}

// Verify payment status
export const verifyPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user!.id;

    // Find payment session
    const paymentSession = await prisma.paymentSession.findUnique({
      where: { transactionId },
      include: {
        order: {
          include: {
            orderItems: {
              include: { product: true }
            }
          }
        }
      }
    });

    if (!paymentSession || paymentSession.userId !== userId) {
      return res.status(404).json({ error: 'Payment session not found' });
    }

    // Check with PhonePe if status is still pending
    if (paymentSession.status === 'PENDING') {
      try {
        const statusResponse = await phonePeService.checkPaymentStatus(transactionId);
        
        if (statusResponse.success && statusResponse.data) {
          const newStatus = statusResponse.data.state === 'COMPLETED' ? 'SUCCESS' : 
                           statusResponse.data.state === 'FAILED' ? 'FAILED' : 'PENDING';

          // Update payment session
          const updatedSession = await prisma.paymentSession.update({
            where: { id: paymentSession.id },
            data: {
              status: newStatus,
              phonePeTransactionId: statusResponse.data.transactionId,
              completedAt: newStatus === 'SUCCESS' ? new Date() : null,
              statusCheckResponse: statusResponse as any
            }
          });

          // Create order if payment successful
          if (newStatus === 'SUCCESS' && !paymentSession.orderId) {
            await createOrderFromPaymentSession(updatedSession);
          }

          // Fetch updated data
          const finalSession = await prisma.paymentSession.findUnique({
            where: { id: paymentSession.id },
            include: {
              order: {
                include: {
                  orderItems: {
                    include: { product: true }
                  }
                }
              }
            }
          });

          return res.json({
            paymentSession: finalSession,
            paymentStatus: newStatus
          });
        }
      } catch (statusError) {
        console.error('Status check error:', statusError);
      }
    }

    res.json({
      paymentSession,
      paymentStatus: paymentSession.status
    });
  } catch (error) {
    console.error('Verify payment status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get user orders (existing functionality)
export const getUserOrders = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  images: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.order.count({ where: { userId } })
    ]);

    res.json({
      orders,
      pagination: {
        page: parseInt(page as string),
        limit: take,
        total: totalCount,
        pages: Math.ceil(totalCount / take)
      }
    });
  } catch (error) {
    console.error('Get user orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get order by ID (existing functionality)
export const getOrderById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const isAdmin = req.user!.isAdmin;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: {
          include: { product: true }
        },
        user: {
          include: { userDetails: true }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.userId !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ order });
  } catch (error) {
    console.error('Get order by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Admin functions (existing functionality)
export const getAllOrders = async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      paymentStatus,
      startDate,
      endDate
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = {};

    if (status) where.deliveryStatus = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  images: true
                }
              }
            }
          },
          user: {
            select: {
              id: true,
              name: true,
              username: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      orders,
      pagination: {
        page: parseInt(page as string),
        limit: take,
        total: totalCount,
        pages: Math.ceil(totalCount / take)
      }
    });
  } catch (error) {
    console.error('Get all orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { deliveryStatus, paymentStatus } = req.body;

    const updateData: any = {};
    if (deliveryStatus) updateData.deliveryStatus = deliveryStatus;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;

    const order = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        orderItems: {
          include: { product: true }
        },
        user: {
          include: { userDetails: true }
        }
      }
    });

    res.json({
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Clean up expired payment sessions
export const cleanupExpiredSessions = async () => {
  try {
    const result = await prisma.paymentSession.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: {
          lt: new Date()
        }
      },
      data: {
        status: 'EXPIRED'
      }
    });
    
    console.log(`Marked ${result.count} payment sessions as expired`);
    return result.count;
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error);
    return 0;
  }
};

// Schedule cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);