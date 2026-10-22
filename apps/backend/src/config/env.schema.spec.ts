import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { baseEnvSchema } from '../common/config/base-env.schema.js';
import { projectEnvSchema } from './env.schema.js';

const ENV_KEYS = [
  'DATABASE_URL',
  'PORT',
  'NODE_ENV',
  'FRONTEND_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'TRUST_PROXY_HOPS',
  'OTP_SENDER',
  'OTP_TTL_MINUTES',
  'OTP_RESEND_COOLDOWN_SECONDS',
  'MAX_OTP_ATTEMPTS',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'THROTTLE_DEFAULT_LIMIT',
  'THROTTLE_AUTH_LIMIT',
  'THROTTLE_SEND_CODE_LIMIT',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_FOLDER',
  'MALANG_MIN_LAT',
  'MALANG_MAX_LAT',
  'MALANG_MIN_LNG',
  'MALANG_MAX_LNG',
  'ESCALATION_CRON_MINUTES',
  'ESCALATION_STEP_2_DAYS',
] as const;

// Every required key of the combined schema, so a test only has to remove
// the one it exercises.
const requiredEnv: Record<string, string> = {
  DATABASE_URL:
    'postgresql://postgres:postgres@localhost:5432/sigap?schema=public',
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  CLOUDINARY_CLOUD_NAME: 'demo-cloud',
  CLOUDINARY_API_KEY: 'demo-key',
  CLOUDINARY_API_SECRET: 'demo-secret',
};

const bootModule = (): Promise<TestingModule> =>
  Test.createTestingModule({
    // ignoreEnvFile keeps boot validation deterministic: only process.env,
    // controlled by the test, is validated.
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validationSchema: baseEnvSchema.concat(projectEnvSchema),
        validationOptions: { abortEarly: false, allowUnknown: true },
      }),
    ],
  }).compile();

describe('projectEnvSchema boot validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('refuses to boot when DATABASE_URL is missing', async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      if (key !== 'DATABASE_URL') process.env[key] = value;
    }

    await expect(bootModule()).rejects.toThrow(/DATABASE_URL/);
  });

  it('refuses to boot when JWT_SECRET is missing', async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      if (key !== 'JWT_SECRET') process.env[key] = value;
    }

    await expect(bootModule()).rejects.toThrow(/JWT_SECRET/);
  });

  it('refuses to boot when a Cloudinary key is missing', async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      if (key !== 'CLOUDINARY_CLOUD_NAME') process.env[key] = value;
    }

    await expect(bootModule()).rejects.toThrow(/CLOUDINARY_CLOUD_NAME/);
  });

  it('refuses production when OTP_SENDER is resend without the Resend keys', async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      process.env[key] = value;
    }
    process.env.NODE_ENV = 'production';
    process.env.OTP_SENDER = 'resend';

    await expect(bootModule()).rejects.toThrow(/RESEND_API_KEY.*MAIL_FROM/s);
  });

  it('refuses development when OTP_SENDER is resend without the Resend keys', async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      process.env[key] = value;
    }
    process.env.NODE_ENV = 'development';
    process.env.OTP_SENDER = 'resend';

    await expect(bootModule()).rejects.toThrow(/RESEND_API_KEY/);
  });

  it('boots in production with a Resend configuration when the keys are present', async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      process.env[key] = value;
    }
    process.env.NODE_ENV = 'production';
    process.env.OTP_SENDER = 'resend';
    process.env.RESEND_API_KEY = 're_demo_key';
    process.env.MAIL_FROM = 'SIGAP Lapor <no-reply@sigap.example>';

    const moduleRef = await bootModule();
    const config = moduleRef.get(ConfigService);
    expect(config.getOrThrow<string>('NODE_ENV')).toBe('production');
  });

  it('boots with the documented defaults when every required key is present', async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      process.env[key] = value;
    }

    const moduleRef = await bootModule();
    const config = moduleRef.get(ConfigService);
    expect(config.getOrThrow<string>('OTP_SENDER')).toBe('console');
    expect(config.getOrThrow<number>('OTP_TTL_MINUTES')).toBe(10);
    expect(config.getOrThrow<number>('OTP_RESEND_COOLDOWN_SECONDS')).toBe(60);
    expect(config.getOrThrow<number>('MAX_OTP_ATTEMPTS')).toBe(5);
    expect(config.getOrThrow<number>('THROTTLE_DEFAULT_LIMIT')).toBe(100);
    expect(config.getOrThrow<number>('THROTTLE_AUTH_LIMIT')).toBe(5);
    expect(config.getOrThrow<number>('THROTTLE_SEND_CODE_LIMIT')).toBe(3);
    expect(config.getOrThrow<string>('CLOUDINARY_FOLDER')).toBe('sigap-lapor');
    expect(config.getOrThrow<number>('MALANG_MIN_LAT')).toBe(-8);
    expect(config.getOrThrow<number>('MALANG_MAX_LAT')).toBe(-7.85);
    expect(config.getOrThrow<number>('MALANG_MIN_LNG')).toBe(112.55);
    expect(config.getOrThrow<number>('MALANG_MAX_LNG')).toBe(112.82);
    expect(config.getOrThrow<number>('ESCALATION_CRON_MINUTES')).toBe(15);
    expect(config.getOrThrow<number>('ESCALATION_STEP_2_DAYS')).toBe(2);
  });

  it('applies env overrides to the throttle limits (BR-133)', async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      process.env[key] = value;
    }
    process.env.THROTTLE_AUTH_LIMIT = '7';
    process.env.THROTTLE_SEND_CODE_LIMIT = '2';

    const moduleRef = await bootModule();
    const config = moduleRef.get(ConfigService);
    expect(config.getOrThrow<number>('THROTTLE_DEFAULT_LIMIT')).toBe(100);
    expect(config.getOrThrow<number>('THROTTLE_AUTH_LIMIT')).toBe(7);
    expect(config.getOrThrow<number>('THROTTLE_SEND_CODE_LIMIT')).toBe(2);
  });
});
