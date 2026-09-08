import { HttpError } from '../utils/httpError';

export class SMSService {
  static async sendOTP(phone: string, code: string): Promise<void> {
    const transport = process.env.SMS_TRANSPORT;
    if (transport === 'test' && process.env.NODE_ENV === 'test') return;
    if (transport !== 'msg91') {
      throw new HttpError(503, 'SMS delivery is not configured', 'SMS_NOT_CONFIGURED');
    }

    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;
    if (!authKey || !templateId) {
      throw new HttpError(503, 'SMS delivery is not configured', 'SMS_NOT_CONFIGURED');
    }
    const response = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: { authkey: authKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        mobile: phone.replace(/^\+/, ''),
        otp: code,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new HttpError(503, 'SMS delivery failed', 'SMS_DELIVERY_FAILED');
    }
  }
}
