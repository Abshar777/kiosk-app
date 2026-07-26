import type { AcademyConfig, AppConfig, KioskConfig, PaymentMethod } from '@course-lms/shared';
import { db, parseJson } from '../db.ts';

const DEFAULT_ACADEMY: AcademyConfig = {
  name: 'Delta Academy',
  tagline: 'Learn the skills that move you forward',
  logoUrl: null,
  contactPhone: '+91 484 123 4567',
  supportNumber: '+91 98470 00000',
  email: 'admissions@delta-academy.example',
  address: 'MG Road, Kochi, Kerala 682016',
  website: 'https://delta-academy.example',
};

const DEFAULT_KIOSK: KioskConfig = {
  autoReturnSeconds: 45,
  idleResetSeconds: 180,
  autoPrintReceipt: true,
  autoPrintDelayMs: 900,
  defaultLanguage: 'en',
  availableLanguages: ['en', 'ar'],
  currency: 'INR',
  currencySymbol: '₹',
};

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = ['upi', 'card', 'netbanking'];

function read<T>(key: string, fallback: T): T {
  const row = db.query('SELECT value FROM settings WHERE key = $key').get({ $key: key }) as
    | { value: string }
    | null;
  if (!row) return fallback;
  const parsed = parseJson<T | null>(row.value, null);
  // Merge over defaults so a config written by an older version stays complete.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { ...fallback, ...parsed } as T;
  }
  return parsed ?? fallback;
}

function write(key: string, value: unknown): void {
  db.query(
    `INSERT INTO settings (key, value) VALUES ($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run({ $key: key, $value: JSON.stringify(value) });
}

export function getConfig(): AppConfig {
  return {
    academy: read('academy', DEFAULT_ACADEMY),
    kiosk: read('kiosk', DEFAULT_KIOSK),
    enabledPaymentMethods: read('enabledPaymentMethods', DEFAULT_PAYMENT_METHODS),
  };
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const current = getConfig();
  if (patch.academy) write('academy', { ...current.academy, ...patch.academy });
  if (patch.kiosk) write('kiosk', { ...current.kiosk, ...patch.kiosk });
  if (patch.enabledPaymentMethods) write('enabledPaymentMethods', patch.enabledPaymentMethods);
  return getConfig();
}

export function seedDefaultConfig(): void {
  const existing = db.query('SELECT COUNT(*) AS count FROM settings').get() as { count: number };
  if (existing.count > 0) return;
  write('academy', DEFAULT_ACADEMY);
  write('kiosk', DEFAULT_KIOSK);
  write('enabledPaymentMethods', DEFAULT_PAYMENT_METHODS);
}
