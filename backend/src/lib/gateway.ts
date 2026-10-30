import type { CreatePaymentRequest, PaymentMethod } from '@course-lms/shared';
import { newGatewayRef } from './ids.ts';
import {
  FieldErrors,
  isValidCardNumber,
  isValidExpiry,
  isValidUpiId,
  maskCard,
} from './validation.ts';

export interface GatewayChargeRequest {
  method: PaymentMethod;
  amount: number;
  currency: string;
  details: CreatePaymentRequest;
}

export interface GatewayChargeResult {
  status: 'success' | 'failed';
  gatewayRef: string | null;
  /** Masked, display-safe instrument descriptor. Never the raw value. */
  instrument: string | null;
  failureReason: string | null;
}

export interface PaymentGateway {
  readonly name: string;
  charge(request: GatewayChargeRequest): Promise<GatewayChargeResult>;
}

export const SUPPORTED_BANKS = [
  { code: 'HDFC', name: 'HDFC Bank' },
  { code: 'ICICI', name: 'ICICI Bank' },
  { code: 'SBI', name: 'State Bank of India' },
  { code: 'AXIS', name: 'Axis Bank' },
  { code: 'KOTAK', name: 'Kotak Mahindra Bank' },
  { code: 'FEDERAL', name: 'Federal Bank' },
  { code: 'PNB', name: 'Punjab National Bank' },
  { code: 'BOB', name: 'Bank of Baroda' },
] as const;

/**
 * Validates instrument details for the chosen method and returns the masked
 * descriptor that is safe to persist. Raw PANs and CVVs never leave this
 * function.
 */
export function validateInstrument(
  method: PaymentMethod,
  details: CreatePaymentRequest,
): { instrument: string; errors: FieldErrors } {
  const errors = new FieldErrors();

  switch (method) {
    // The card machine collects and validates the card on its own hardware, so
    // there is nothing for us to check and nothing sensitive to mask.
    case 'card_present':
      return { instrument: 'Card machine', errors };

    case 'upi': {
      const upiId = (details.upiId ?? '').trim();
      if (!upiId) {
        errors.add('upiId', 'UPI ID is required');
      } else if (!isValidUpiId(upiId)) {
        errors.add('upiId', 'Enter a valid UPI ID, for example name@bank');
      }
      return { instrument: upiId, errors };
    }

    case 'card': {
      const cardNumber = (details.cardNumber ?? '').trim();
      const cardHolder = (details.cardHolder ?? '').trim();
      const cardExpiry = (details.cardExpiry ?? '').trim();
      const cardCvv = (details.cardCvv ?? '').trim();

      if (!cardNumber) errors.add('cardNumber', 'Card number is required');
      else if (!isValidCardNumber(cardNumber)) errors.add('cardNumber', 'Enter a valid card number');

      if (!cardHolder) errors.add('cardHolder', 'Cardholder name is required');

      if (!cardExpiry) errors.add('cardExpiry', 'Expiry date is required');
      else if (!isValidExpiry(cardExpiry)) errors.add('cardExpiry', 'Enter a valid future expiry (MM/YY)');

      if (!cardCvv) errors.add('cardCvv', 'CVV is required');
      else if (!/^\d{3,4}$/.test(cardCvv)) errors.add('cardCvv', 'CVV must be 3 or 4 digits');

      return { instrument: cardNumber ? maskCard(cardNumber) : '', errors };
    }

    case 'netbanking': {
      const bankCode = (details.bankCode ?? '').trim().toUpperCase();
      if (!bankCode) {
        errors.add('bankCode', 'Please select your bank');
        return { instrument: '', errors };
      }
      const bank = SUPPORTED_BANKS.find((b) => b.code === bankCode);
      if (!bank && bankCode !== 'FAIL') {
        errors.add('bankCode', 'Select a supported bank');
        return { instrument: '', errors };
      }
      return { instrument: bank?.name ?? bankCode, errors };
    }
  }
}

/** Deterministic decline triggers, so the failure/retry path is demonstrable. */
function declineReason(request: GatewayChargeRequest): string | null {
  const { method, details } = request;

  if (method === 'upi' && (details.upiId ?? '').trim().toLowerCase().startsWith('fail@')) {
    return 'Payment declined by the UPI handle provider';
  }
  // 4000 0000 0000 0002 is the industry-standard "card declined" test number.
  if (method === 'card' && (details.cardNumber ?? '').replace(/\D/g, '') === '4000000000000002') {
    return 'Card declined by the issuing bank';
  }
  if (method === 'netbanking' && (details.bankCode ?? '').trim().toUpperCase() === 'FAIL') {
    return 'Bank gateway is temporarily unavailable';
  }
  return null;
}

/**
 * Stand-in for a real PSP (Razorpay, Stripe, PayTabs…). It mirrors the shape a
 * real integration would have — async, returns a gateway reference, can decline
 * — so swapping in a live provider means implementing {@link PaymentGateway}
 * and changing the export below, with no changes to the routes.
 */
export const simulatedGateway: PaymentGateway = {
  name: 'simulated',

  async charge(request: GatewayChargeRequest): Promise<GatewayChargeResult> {
    const { instrument } = validateInstrument(request.method, request.details);

    // Mimic real network/authorisation latency so the kiosk's processing state
    // is visible and honest rather than an artificial flash.
    const latency = Number(process.env.PAYMENT_LATENCY_MS ?? 1200);
    await new Promise((resolve) => setTimeout(resolve, latency));

    const forced = declineReason(request);
    if (forced) {
      return { status: 'failed', gatewayRef: null, instrument, failureReason: forced };
    }

    // Optional random failures for load/QA testing. Defaults to 0 so a live
    // demo never fails unexpectedly.
    const failureRate = Number(process.env.PAYMENT_FAILURE_RATE ?? 0);
    if (failureRate > 0 && Math.random() < failureRate) {
      return {
        status: 'failed',
        gatewayRef: null,
        instrument,
        failureReason: 'Transaction could not be completed. Please try again.',
      };
    }

    return {
      status: 'success',
      gatewayRef: newGatewayRef(),
      instrument,
      failureReason: null,
    };
  },
};

export const gateway: PaymentGateway = simulatedGateway;
