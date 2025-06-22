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

export class PhonePeService {
  private merchantId: string;
  private saltKey: string;
  private saltIndex: string;
  private baseUrl: string;

  constructor() {
    this.merchantId = process.env.PHONEPE_MERCHANT_ID!;
    this.saltKey = process.env.PHONEPE_SALT_KEY!;
    this.saltIndex = process.env.PHONEPE_SALT_INDEX!;
    this.baseUrl = 'https://api.phonepe.com/apis/hermes';
  }

  generateChecksum(payload: string): string {
    const string = payload + '/pg/v1/pay' + this.saltKey;
    const sha256 = crypto.createHash('sha256').update(string).digest('hex');
    return sha256 + '###' + this.saltIndex;
  }

  generatePaymentPayload(orderId: string, amount: number, userId: string): PhonePePaymentRequest {
    return {
      merchantId: this.merchantId,
      merchantTransactionId: orderId,
      merchantUserId: userId,
      amount: amount * 100, // Convert to paise
      redirectUrl: `${process.env.FRONTEND_URL}/payment/success`,
      redirectMode: 'POST',
      callbackUrl: `${process.env.BACKEND_URL}/api/payment/callback`,
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    };
  }

  async initiatePayment(orderId: string, amount: number, userId: string) {
    try {
      const payload = this.generatePaymentPayload(orderId, amount, userId);
      const payloadString = JSON.stringify(payload);
      const payloadBase64 = Buffer.from(payloadString).toString('base64');
      const checksum = this.generateChecksum(payloadBase64);

      const response = await fetch(`${this.baseUrl}/pg/v1/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
        },
        body: JSON.stringify({
          request: payloadBase64,
        }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('PhonePe payment initiation error:', error);
      throw error;
    }
  }

  verifyPaymentCallback(response: string, checksum: string): boolean {
    const string = response + this.saltKey;
    const sha256 = crypto.createHash('sha256').update(string).digest('hex');
    const generatedChecksum = sha256 + '###' + this.saltIndex;
    return generatedChecksum === checksum;
  }
}

export const phonePeService = new PhonePeService();