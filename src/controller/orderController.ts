import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { emailService } from '../services/emailService';
import { mockPaymentService } from '../services/paymentService';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { paymentMethod, shippingAddress } = req.body;
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userDetails: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const requiredFields = ['name', 'phone', 'address', 'city', 'state', 'pincode'];
    for (const field of requiredFields) {
      if (!shippingAddress[field]) {
        return res.status(400).json({ error: `${field} is required in shipping address` });
      }
    }

    const cartItems = await prisma.cart.findMany({
      where: { userId },
      include: {
        product: true
      }
    });

    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    for (const item of cartItems) {
      if (item.product.stock < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for ${item.product.name}`
        });
      }
    }

    const totalAmount = cartItems.reduce((sum: number, item: { product: { price: number; }; quantity: number; }) =>
      sum + (item.product.price * item.quantity), 0
    );

    const order = await prisma.order.create({
      data: {
        userId,
        totalAmount,
        paymentMethod,
        shippingAddress,
        paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PENDING'
      }
    });

    const orderItems = await Promise.all(
      cartItems.map((item: { productId: any; quantity: any; product: { price: any; }; }) =>
        prisma.orderItem.create({
          data: {
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            price: item.product.price
          }
        })
      )
    );

    await Promise.all(
      cartItems.map((item: { productId: any; quantity: any; }) =>
        prisma.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } }
        })
      )
    );

    await prisma.cart.deleteMany({
      where: { userId }
    });

    const completeOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        orderItems: {
          include: {
            product: true
          }
        },
        user: {
          include: {
            userDetails: true
          }
        }
      }
    });

    try {
      await emailService.sendOrderConfirmation(
        completeOrder!.user.userDetails?.email ?? 'admin@yourdomain.com',
        completeOrder!.user.name || completeOrder!.user.username,
        completeOrder!.id,
        completeOrder!.totalAmount
      );
      await emailService.sendAdminOrderNotification(completeOrder!);
    } catch (emailError) {
      console.error('Email sending error:', emailError);
    }

    res.status(201).json({
      message: 'Order created successfully',
      order: completeOrder
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUserOrders = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
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

    // Fetch payments separately if needed
    const ordersWithPayments = await Promise.all(
      orders.map(async (order) => {
        const latestPayment = await prisma.payment.findFirst({
          where: { orderId: order.id },
          orderBy: { createdAt: 'desc' }
        });
        return {
          ...order,
          latestPayment
        };
      })
    );

    res.json({
      orders: ordersWithPayments,
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

export const getOrderById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.isAdmin;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: {
          include: {
            product: true
          }
        },
        user: {
          include: {
            userDetails: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.userId !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Fetch payments separately
    const payments = await prisma.payment.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ 
      order: {
        ...order,
        payments
      }
    });
  } catch (error) {
    console.error('Get order by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

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

    if (status) {
      where.deliveryStatus = status;
    }

    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

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

    // Fetch latest payment for each order
    const ordersWithPayments = await Promise.all(
      orders.map(async (order) => {
        const latestPayment = await prisma.payment.findFirst({
          where: { orderId: order.id },
          orderBy: { createdAt: 'desc' }
        });
        return {
          ...order,
          latestPayment
        };
      })
    );

    res.json({
      orders: ordersWithPayments,
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
          include: {
            product: true
          }
        },
        user: {
          include: {
            userDetails: true
          }
        }
      }
    });

    // Fetch payments separately
    const payments = await prisma.payment.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      message: 'Order status updated successfully',
      order: {
        ...order,
        payments
      }
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const initiatePayment = async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { orderId } = req.body;
    const userId = req.user!.id;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { 
        user: {
          include: { userDetails: true }
        }
      }
    });

    if (!order || order.userId !== userId) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.paymentStatus !== 'PENDING') {
      return res.status(400).json({ error: 'Payment already processed' });
    }

    if (order.paymentMethod !== 'ONLINE') {
      return res.status(400).json({ error: 'This order does not require online payment' });
    }

    // Check if there's already a pending payment for this order
    const existingPayment = await prisma.payment.findFirst({
      where: {
        orderId: orderId,
        status: 'PENDING'
      }
    });

    if (existingPayment) {
      // Return existing payment details
      return res.json({
        message: 'Payment already initiated',
        paymentUrl: existingPayment.paymentUrl!,
        transactionId: existingPayment.transactionId,
        paymentId: existingPayment.id
      });
    }

    const callbackUrl = `${process.env.APP_URL || 'http://localhost:3000'}/payment/callback`;

    const paymentResponse = await mockPaymentService.initiatePayment({
      merchantTransactionId: orderId,
      merchantUserId: userId.toString(),
      amount: order.totalAmount,
      callbackUrl: callbackUrl,
      mobileNumber: order.user.userDetails?.phone ?? undefined,
    });

    if (!paymentResponse.success) {
      return res.status(502).json({ error: paymentResponse.error || 'Payment initiation failed' });
    }

    // Create payment record in database
    const payment = await prisma.payment.create({
      data: {
        orderId: orderId,
        userId: userId,
        transactionId: paymentResponse.transactionId!,
        merchantTransactionId: orderId,
        amount: order.totalAmount,
        status: 'PENDING',
        paymentUrl: paymentResponse.paymentUrl!,
        callbackUrl: callbackUrl,
        mobileNumber: order.user.userDetails?.phone ?? undefined
      }
    });

    res.json({
      message: 'Payment initiated successfully',
      paymentUrl: paymentResponse.paymentUrl!,
      transactionId: paymentResponse.transactionId!,
      paymentId: payment.id
    });
  } catch (err) {
    console.error('Initiate payment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const verifyPayment = async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { transactionId } = req.body;
    const userId = req.user!.id;

    // Find payment record
    const payment = await prisma.payment.findUnique({
      where: { transactionId: transactionId },
      include: {
        order: {
          include: {
            user: { include: { userDetails: true } },
            orderItems: { include: { product: true } }
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check payment status with mock service
    const statusResult = await mockPaymentService.checkPaymentStatus(transactionId);

    if (!statusResult.success) {
      return res.status(400).json({ 
        error: 'Unable to verify payment status', 
        status: statusResult.status 
      });
    }

    // Update payment record
    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: statusResult.status as any,
        completedAt: statusResult.status === 'SUCCESS' ? new Date() : null,
        gatewayResponse: {
          paymentMethod: statusResult.paymentMethod,
          verifiedAt: new Date().toISOString(),
          amount: statusResult.amount
        }
      }
    });

    let updatedOrder = payment.order;

    // Update order status if payment successful
    if (statusResult.status === 'SUCCESS') {
      updatedOrder = await prisma.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: 'PAID',
          paymentId: transactionId,
        },
        include: {
          orderItems: { include: { product: true } },
          user: { include: { userDetails: true } }
        }
      });

      // Send confirmation emails
      try {
        await emailService.sendOrderConfirmation(
          updatedOrder.user.userDetails?.email ?? 'admin@yourdomain.com',
          updatedOrder.user.name || updatedOrder.user.username,
          updatedOrder.id,
          updatedOrder.totalAmount
        );
        await emailService.sendAdminOrderNotification(updatedOrder);
      } catch (emailErr) {
        console.error('Email error on payment verify:', emailErr);
      }
    } else if (statusResult.status === 'FAILURE') {
      updatedOrder = await prisma.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: 'FAILED'
        },
        include: {
          orderItems: { include: { product: true } },
          user: { include: { userDetails: true } }
        }
      });
    }

    // Fetch all payments for this order
    const allPayments = await prisma.payment.findMany({
      where: { orderId: payment.orderId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      message: `Payment ${statusResult.status.toLowerCase()}`,
      paymentStatus: statusResult.status,
      order: {
        ...updatedOrder,
        payments: allPayments
      },
      payment: updatedPayment
    });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get payment details for an order
export const getPaymentDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.isAdmin;

    const payments = await prisma.payment.findMany({
      where: { orderId },
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            totalAmount: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (payments.length === 0) {
      return res.status(404).json({ error: 'No payments found for this order' });
    }

    // Check access permissions
    const order = payments[0].order;
    if (order.userId !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      payments
    });
  } catch (error) {
    console.error('Get payment details error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};