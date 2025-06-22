// services/emailService.ts
import { Resend } from 'resend';
import { PrismaClient, Prisma } from '@prisma/client'; // Import Prisma for types

const resend = new Resend(process.env.RESEND_API_KEY!);

// Define a type for the Order with its included relations
// This type should match how you're querying the order in your controller
type OrderWithUserAndItems = Prisma.OrderGetPayload<{
  include: {
    user: {
      include: {
        userDetails: true;
      };
    };
    orderItems: {
      include: {
        product: true;
      };
    };
  };
}>;


export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

export class EmailService {
  private static instance: EmailService;
  private defaultFrom = 'noreply@yourdomain.com';

  private constructor() {}

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /** Low-level email send */
  public async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const { data, error } = await resend.emails.send({
        from: options.from || this.defaultFrom,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
      });
      if (error) {
        console.error('Email sending error:', error);
        return false;
      }
      console.log('Email sent successfully:', data);
      return true;
    } catch (err) {
      console.error('Email service error:', err);
      return false;
    }
  }

  /** Welcome email */
  public async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Our Store!</h2>
        <p>Hi ${name},</p>
        <p>Thank you for registering with us. We're excited to have you as a customer!</p>
        <div style="margin: 20px 0;">
          <a href="${process.env.FRONTEND_URL}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Visit Our Store</a>
        </div>
        <p>Best regards,<br/>Your Store Team</p>
      </div>
    `;
    return this.sendEmail({ to: email, subject: 'Welcome to Our Store!', html });
  }

  /** Order confirmation email to customer */
  public async sendOrderConfirmation(email: string, name: string, orderId: string, totalAmount: number): Promise<boolean> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Order Confirmation</h2>
        <p>Hi ${name},</p>
        <p>Thank you for your order! We've received your order and it's being processed.</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Order Details:</h3>
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p><strong>Total Amount:</strong> ₹${totalAmount.toFixed(2)}</p>
        </div>
        <p>You'll receive another email when your order ships.</p>
        <p>Best regards,<br/>Your Store Team</p>
      </div>
    `;
    return this.sendEmail({
      to: email,
      subject: `Order Confirmation - ${orderId}`,
      html
    });
  }

  /** Password reset email */
  public async sendPasswordReset(email: string, resetToken: string): Promise<boolean> {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>You requested a password reset. Click the button below to reset your password:</p>
        <div style="margin: 20px 0;">
          <a href="${resetUrl}" style="background-color: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
        </div>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <p>Best regards,<br/>Your Store Team</p>
      </div>
    `;
    return this.sendEmail({ to: email, subject: 'Password Reset Request', html });
  }

  /** Admin notification on new order */
  public async sendAdminOrderNotification(order: OrderWithUserAndItems): Promise<boolean> {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@yourdomain.com';
    const orderItemsHtml = order.orderItems.map(item => `
      <li>${item.product.name} (x${item.quantity}) - ₹${item.price.toFixed(2)}</li>
    `).join('');
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Order Notification (Admin)</h2>
        <p>A new order has been placed on your store!</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Order Details:</h3>
          <p><strong>Order ID:</strong> ${order.id}</p>
          <p><strong>Total Amount:</strong> ₹${order.totalAmount.toFixed(2)}</p>
          <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
          <p><strong>Payment Status:</strong> ${order.paymentStatus}</p>
          <h4>Customer Information:</h4>
          <p><strong>Name:</strong> ${order.user.name || order.user.username}</p>
          <p><strong>Email:</strong> ${order.user.email}</p>
          <p><strong>Phone:</strong> ${order.user.userDetails?.phone || 'N/A'}</p>
          <h4>Shipping Address:</h4>
          <p>${order.shippingAddress.name}</p>
          <p>${order.shippingAddress.address}</p>
          <p>${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.pincode}</p>
          <p><strong>Phone:</strong> ${order.shippingAddress.phone}</p>
          <h4>Items:</h4>
          <ul>${orderItemsHtml}</ul>
        </div>
        <p>Please log in to your admin panel for more details.</p>
        <p>Best regards,<br/>Your Store Admin</p>
      </div>
    `;
    return this.sendEmail({
      to: adminEmail,
      subject: `New Order #${order.id} - ${order.user.name || order.user.username}`, // Use username if name is null
      html
    });
  }
}

export const emailService = EmailService.getInstance();