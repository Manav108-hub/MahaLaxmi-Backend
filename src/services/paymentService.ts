// services/phonePeService.ts
import crypto from 'crypto';

export interface PhonePePaymentRequest {
  merchantId: string;
  merchantTransactionId: string;
  merchantUserId: string;
  amount: number;
  redirectUrl: string;
  redirectMode: string;
  callbackUrl: string;
  mobileNumber?: string;
  paymentInstrument: {
    type: string;
  };
}

export interface PhonePeResponse {
  success: boolean;
  code: string;
  message: string;
  data?: {
    merchantId: string;
    merchantTransactionId: string;
    instrumentResponse: {
      type: string;
      redirectInfo: {
        url: string;
        method: string;
      };
    };
  };
}

export interface PaymentStatusResponse {
  success: boolean;
  code: string;
  message: string;
  data?: {
    merchantId: string;
    merchantTransactionId: string;
    transactionId: string;
    amount: number;
    state: 'PENDING' | 'COMPLETED' | 'FAILED';
    responseCode: string;
    paymentInstrument: {
      type: string;
    };
  };
}

export class PhonePeService {
  private merchantId: string;
  private saltKey: string;
  private saltIndex: string;
  private baseUrl: string;

  constructor() {
    this.merchantId = process.env.PHONEPE_MERCHANT_ID || 'PGTESTPAYUAT';
    this.saltKey = process.env.PHONEPE_SALT_KEY || '099eb0cd-02cf-4e2a-8aca-3e6c6aff0399';
    this.saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
    this.baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://api.phonepe.com/apis/hermes'
      : 'https://api-preprod.phonepe.com/apis/hermes';
    
    // Validate required credentials
    if (!this.merchantId || !this.saltKey || !this.saltIndex) {
      throw new Error('PhonePe credentials are missing. Please check your environment variables.');
    }
    
    console.log('PhonePe Service initialized with:', {
      merchantId: this.merchantId,
      saltIndex: this.saltIndex,
      baseUrl: this.baseUrl
    });
  }

  generateChecksum(payload: string, endpoint: string): string {
    const string = payload + endpoint + this.saltKey;
    const sha256 = crypto.createHash('sha256').update(string).digest('hex');
    return sha256 + '###' + this.saltIndex;
  }

  generateTransactionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `TXN_${timestamp}_${random}`.toUpperCase();
  }

  generatePaymentPayload(
    transactionId: string, 
    amount: number, 
    userId: string,
    mobileNumber?: string
  ): PhonePePaymentRequest {
    const payload = {
      merchantId: this.merchantId,
      merchantTransactionId: transactionId,
      merchantUserId: userId,
      amount: Math.round(amount * 100), // Convert to paise
      redirectUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
      redirectMode: 'POST',
      callbackUrl: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payment/phonepe/callback`,
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    };

    // Only add mobileNumber if provided and valid
    if (mobileNumber && mobileNumber.length === 10) {
      (payload as any).mobileNumber = mobileNumber;
    }

    return payload as PhonePePaymentRequest;
  }

  async initiatePayment(
    transactionId: string, 
    amount: number, 
    userId: string,
    mobileNumber?: string
  ): Promise<PhonePeResponse> {
    try {
      const payload = this.generatePaymentPayload(transactionId, amount, userId, mobileNumber);
      const payloadString = JSON.stringify(payload);
      const payloadBase64 = Buffer.from(payloadString).toString('base64');
      const endpoint = '/pg/v1/pay';
      const checksum = this.generateChecksum(payloadBase64, endpoint);

      console.log('Initiating PhonePe payment:', {
        transactionId,
        amount,
        merchantId: this.merchantId,
        endpoint: `${this.baseUrl}${endpoint}`
      });

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'accept': 'application/json',
        },
        body: JSON.stringify({
          request: payloadBase64,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('PhonePe response:', data);
      
      return data as PhonePeResponse;
    } catch (error) {
      console.error('PhonePe payment initiation error:', error);
      throw new Error('Payment service unavailable');
    }
  }

  async checkPaymentStatus(merchantTransactionId: string): Promise<PaymentStatusResponse> {
    try {
      const endpoint = `/pg/v1/status/${this.merchantId}/${merchantTransactionId}`;
      const checksum = this.generateChecksum('', endpoint);

      console.log('Checking PhonePe payment status:', {
        merchantTransactionId,
        endpoint: `${this.baseUrl}${endpoint}`
      });

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'X-MERCHANT-ID': this.merchantId,
          'accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('PhonePe status response:', data);
      
      return data as PaymentStatusResponse;
    } catch (error) {
      console.error('PhonePe payment status check error:', error);
      throw new Error('Unable to check payment status');
    }
  }

  verifyCallback(response: string, checksum: string): boolean {
    try {
      const expectedChecksum = this.generateChecksum(response, '');
      return expectedChecksum === checksum;
    } catch (error) {
      console.error('Callback verification error:', error);
      return false;
    }
  }

  decodeCallbackResponse(encodedResponse: string): any {
    try {
      const decodedResponse = Buffer.from(encodedResponse, 'base64').toString('utf-8');
      return JSON.parse(decodedResponse);
    } catch (error) {
      console.error('Callback response decode error:', error);
      throw new Error('Invalid callback response format');
    }
  }
}

export const phonePeService = new PhonePeService();