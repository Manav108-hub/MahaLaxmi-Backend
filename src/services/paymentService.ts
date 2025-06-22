// services/paymentService.ts

import crypto from 'crypto';

// Use dynamic import for node-fetch to avoid ESM errors
const fetch = async (...args: Parameters<typeof import('node-fetch')['default']>) => {
  const { default: fetchFn } = await import('node-fetch');
  return fetchFn(...args);
};

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

interface PhonePeApiResponse<T = any> {
  success: boolean;
  data?: T;
  code?: string;
  message?: string;
}

export class PaymentService {
  private static instance: PaymentService;
  private merchantId = process.env.PHONEPE_MERCHANT_ID!;
  private saltKey = process.env.PHONEPE_SALT_KEY!;
  private saltIndex = process.env.PHONEPE_SALT_INDEX!;
  private baseUrl = 'https://api-preprod.phonepe.com/apis/pg-sandbox';

  private constructor() {}

  public static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }
    return PaymentService.instance;
  }

  private generateChecksum(payload: string): string {
    const str = payload + '/pg/v1/pay' + this.saltKey;
    const hash = crypto.createHash('sha256').update(str).digest('hex');
    return `${hash}###${this.saltIndex}`;
  }

  private generateStatusChecksum(txn: string): string {
    const str = `/pg/v1/status/${this.merchantId}/${txn}` + this.saltKey;
    const hash = crypto.createHash('sha256').update(str).digest('hex');
    return `${hash}###${this.saltIndex}`;
  }

  public async initiatePayment(req: PaymentRequest): Promise<PaymentResponse> {
    const payloadObj = {
      merchantId: this.merchantId,
      merchantTransactionId: req.merchantTransactionId,
      merchantUserId: req.merchantUserId,
      amount: Math.round(req.amount * 100),
      redirectUrl: req.callbackUrl,
      callbackUrl: req.callbackUrl,
      redirectMode: 'POST',
      mobileNumber: req.mobileNumber ?? undefined,
      paymentInstrument: { type: 'PAY_PAGE' },
    };

    const base64Payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
    const checksum = this.generateChecksum(base64Payload);

    const response = await fetch(`${this.baseUrl}/pg/v1/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
      },
      body: JSON.stringify({ request: base64Payload }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = (await response.json()) as PhonePeApiResponse<{
      instrumentResponse?: {
        redirectInfo?: { url: string };
      };
    }>;

    if (result.success && result.data?.instrumentResponse?.redirectInfo?.url) {
      return {
        success: true,
        paymentUrl: result.data.instrumentResponse.redirectInfo.url,
        transactionId: req.merchantTransactionId,
      };
    }

    const errMsg = result.code ? `[${result.code}] ${result.message}` : result.message || 'Payment initiation failed';
    return { success: false, error: errMsg };
  }

  public async checkPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    const checksum = this.generateStatusChecksum(transactionId);

    const response = await fetch(
      `${this.baseUrl}/pg/v1/status/${this.merchantId}/${transactionId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'X-MERCHANT-ID': this.merchantId,
        },
      }
    );

    if (!response.ok) {
      return { success: false, status: 'FAILURE', transactionId };
    }

    const result = (await response.json()) as PhonePeApiResponse<{
      state?: 'COMPLETED' | 'FAILED' | string;
      amount?: number;
      paymentInstrument?: { type: string };
    }>;

    if (result.success && result.data) {
      let status: PaymentStatus['status'] = 'PENDING';
      if (result.data.state === 'COMPLETED') status = 'SUCCESS';
      if (result.data.state === 'FAILED') status = 'FAILURE';

      return {
        success: true,
        status,
        transactionId,
        amount: result.data.amount ? result.data.amount / 100 : undefined,
        paymentMethod: result.data.paymentInstrument?.type,
      };
    }

    return {
      success: false,
      status: 'FAILURE',
      transactionId,
    };
  }

  public generateTransactionId(userId: string): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).substr(2, 8);
    return `TXN_${userId}_${ts}_${rand}`.toUpperCase();
  }
}

export const paymentService = PaymentService.getInstance();
