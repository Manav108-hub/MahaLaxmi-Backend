import { Resend } from 'resend';

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export const sendEmail = async (options: EmailOptions) => {
  try {
    const { data, error } = await resend.emails.send({
      from: options.from || 'noreply@yourdomain.com',
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    if (error) {
      console.error('Email sending error:', error);
      return { success: false, error };
    }

    console.log('Email sent successfully:', data?.id);
    return { success: true, data };
  } catch (error) {
    console.error('Email service error:', error);
    return { success: false, error };
  }
};

// Email templates
export const emailTemplates = {
  orderConfirmation: (orderId: string, customerName: string, totalAmount: number) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Order Confirmation</h2>
      <p>Dear ${customerName},</p>
      <p>Thank you for your order! Your order has been confirmed.</p>
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3>Order Details:</h3>
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Total Amount:</strong> ₹${totalAmount}</p>
      </div>
      <p>We'll send you another email when your order ships.</p>
      <p>Best regards,<br>Your E-commerce Team</p>
    </div>
  `,

  orderShipped: (orderId: string, customerName: string, trackingNumber?: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Order Shipped</h2>
      <p>Dear ${customerName},</p>
      <p>Great news! Your order has been shipped.</p>
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3>Shipping Details:</h3>
        <p><strong>Order ID:</strong> ${orderId}</p>
        ${trackingNumber ? `<p><strong>Tracking Number:</strong> ${trackingNumber}</p>` : ''}
      </div>
      <p>You should receive your order within 3-5 business days.</p>
      <p>Best regards,<br>Your E-commerce Team</p>
    </div>
  `,

  welcomeEmail: (customerName: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Welcome to Our Store!</h2>
      <p>Hello ${customerName},</p>
      <p>Welcome to our e-commerce platform! We're excited to have you as a customer.</p>
      <p>Start exploring our products and enjoy shopping with us.</p>
      <p>Best regards,<br>Your E-commerce Team</p>
    </div>
  `
};

export default resend;