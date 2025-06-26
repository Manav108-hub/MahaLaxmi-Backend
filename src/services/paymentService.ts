// services/mockPaymentService.ts
import crypto from 'crypto';

export interface PaymentRequest {
  merchantTransactionId: string;
  merchantUserId: string;
  amount: number;
  callbackUrl: string;
  mobileNumber?: string;
}

export interface PaymentResponse {
  success: boolean;
  paymentUrl?: string;
  transactionId?: string;
  error?: string;
}

export interface PaymentStatus {
  success: boolean;
  status: 'PENDING' | 'SUCCESS' | 'FAILURE';
  transactionId: string;
  amount?: number;
  paymentMethod?: string;
}

export class MockPaymentService {
  private static instance: MockPaymentService;
  private baseUrl = process.env.BACKEND_URL || 'http://localhost:5000';

  // Store payment sessions in memory (use Redis in production)
  private paymentSessions = new Map<string, {
    amount: number;
    userId: string;
    orderId: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILURE';
    createdAt: Date;
  }>();

  private constructor() {}

  public static getInstance(): MockPaymentService {
    if (!MockPaymentService.instance) {
      MockPaymentService.instance = new MockPaymentService();
    }
    return MockPaymentService.instance;
  }

  public async initiatePayment(req: PaymentRequest): Promise<PaymentResponse> {
    try {
      // Simulate API delay
      await this.delay(500);

      const transactionId = this.generateTransactionId(req.merchantUserId);
      
      // Store payment session
      this.paymentSessions.set(transactionId, {
        amount: req.amount,
        userId: req.merchantUserId,
        orderId: req.merchantTransactionId,
        status: 'PENDING',
        createdAt: new Date()
      });

      // Create mock payment URL
      const paymentUrl = `${this.baseUrl}/mock-payment?txn=${transactionId}&amt=${req.amount}&callback=${encodeURIComponent(req.callbackUrl)}`;

      return {
        success: true,
        paymentUrl,
        transactionId,
      };
    } catch (error) {
      console.error('Mock payment initiation error:', error);
      return { success: false, error: 'Payment service unavailable' };
    }
  }

  public async checkPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      // Simulate API delay
      await this.delay(300);

      const session = this.paymentSessions.get(transactionId);
      if (!session) {
        return {
          success: false,
          status: 'FAILURE',
          transactionId,
        };
      }

      // Auto-complete payment after 30 seconds for demo
      const now = new Date();
      const timeDiff = now.getTime() - session.createdAt.getTime();
      
      if (timeDiff > 30000 && session.status === 'PENDING') {
        // 90% success rate for testing
        session.status = Math.random() > 0.1 ? 'SUCCESS' : 'FAILURE';
        this.paymentSessions.set(transactionId, session);
      }

      return {
        success: true,
        status: session.status,
        transactionId,
        amount: session.amount,
        paymentMethod: 'MOCK_GATEWAY',
      };
    } catch (error) {
      console.error('Mock payment status check error:', error);
      return {
        success: false,
        status: 'FAILURE',
        transactionId,
      };
    }
  }

  // Simulate payment completion (for testing)
  public async completePayment(transactionId: string, success: boolean = true): Promise<boolean> {
    const session = this.paymentSessions.get(transactionId);
    if (!session) return false;

    session.status = success ? 'SUCCESS' : 'FAILURE';
    this.paymentSessions.set(transactionId, session);
    return true;
  }

  // Get all payment sessions (for debugging)
  public getPaymentSessions() {
    return Array.from(this.paymentSessions.entries()).map(([id, session]) => ({
      transactionId: id,
      ...session
    }));
  }

  public generateTransactionId(userId: string): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).substr(2, 8);
    return `MOCK_${userId}_${ts}_${rand}`.toUpperCase();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup old sessions (call this periodically)
  public cleanup(): void {
    const now = new Date();
    for (const [id, session] of this.paymentSessions.entries()) {
      const timeDiff = now.getTime() - session.createdAt.getTime();
      // Remove sessions older than 1 hour
      if (timeDiff > 3600000) {
        this.paymentSessions.delete(id);
      }
    }
  }
}

export const mockPaymentService = MockPaymentService.getInstance();

// Clean up old sessions every 10 minutes
setInterval(() => {
  mockPaymentService.cleanup();
}, 600000);