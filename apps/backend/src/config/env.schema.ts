import * as Joi from 'joi';

// Base keys (DATABASE_URL, PORT, NODE_ENV, FRONTEND_URL, JWT_SECRET,
// JWT_EXPIRES_IN, TRUST_PROXY_HOPS) live in the nest-common base schema and
// are validated through the concat in AppConfigModule.forProject.
export const projectEnvSchema = Joi.object({
  OTP_SENDER: Joi.string().valid('resend', 'console').default('console'),
  OTP_TTL_MINUTES: Joi.number().integer().min(1).default(10),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(0).default(60),
  MAX_OTP_ATTEMPTS: Joi.number().integer().min(1).default(5),
  RESEND_API_KEY: Joi.string().when('OTP_SENDER', {
    is: 'resend',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  MAIL_FROM: Joi.string().when('OTP_SENDER', {
    is: 'resend',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  THROTTLE_DEFAULT_LIMIT: Joi.number().integer().min(1).default(100),
  THROTTLE_AUTH_LIMIT: Joi.number().integer().min(1).default(5),
  THROTTLE_SEND_CODE_LIMIT: Joi.number().integer().min(1).default(3),
  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),
  CLOUDINARY_FOLDER: Joi.string().default('sigap-lapor'),
  // Placeholders for the Kota Malang bounding box; verify visually on a
  // Leaflet plot before trusting the geofence (owner decision 2026-10-22).
  MALANG_MIN_LAT: Joi.number().default(-8),
  MALANG_MAX_LAT: Joi.number().default(-7.85),
  MALANG_MIN_LNG: Joi.number().default(112.55),
  MALANG_MAX_LNG: Joi.number().default(112.82),
  ESCALATION_CRON_MINUTES: Joi.number().integer().min(1).default(15),
  ESCALATION_STEP_2_DAYS: Joi.number().integer().min(1).default(2),
});
