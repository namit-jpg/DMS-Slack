import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  SLACK_BOT_TOKEN: z.string().min(1).default('mock-bot-token'),
  SLACK_SIGNING_SECRET: z.string().min(1).default('mock-signing-secret'),
  SLACK_APP_TOKEN: z.string().optional().default('mock-app-token'),
  SLACK_SOCKET_MODE: z.enum(['true', 'false']).transform((v) => v === 'true').default('true'),
  USE_MOCK_SALESFORCE: z.enum(['true', 'false']).transform((v) => v === 'true').default('true'),
  SALESFORCE_AUTH_MODE: z.enum(['SF_CLI', 'OAUTH_PASSWORD', 'CLIENT_CREDENTIALS']).default('OAUTH_PASSWORD'),
  SALESFORCE_CLI_TARGET_ORG: z.string().optional(),
  SALESFORCE_API_VERSION: z.string().default('66.0'),
  SALESFORCE_LOGIN_URL: z.string().optional().default('https://login.salesforce.com'),
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_CLIENT_SECRET: z.string().optional(),
  SALESFORCE_USERNAME: z.string().optional(),
  SALESFORCE_PASSWORD: z.string().optional(),
  SALESFORCE_SECURITY_TOKEN: z.string().optional(),
  SALESFORCE_INSTANCE_URL: z.string().optional(),
  LIVE_TEST_EMAIL: z.string().optional(),
  ALLOW_SAFE_SALESFORCE_TEST_WRITES: z.enum(['true', 'false']).transform((v) => v === 'true').default('false'),
  ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK: z.enum(['true', 'false']).transform((v) => v === 'true').default('true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.string().transform((v) => parseInt(v, 10)).default('3000'),
});

const rawEnv = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || 'mock-bot-token',
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || 'mock-signing-secret',
  SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN || 'mock-app-token',
  SLACK_SOCKET_MODE: process.env.SLACK_SOCKET_MODE || 'true',
  USE_MOCK_SALESFORCE: process.env.USE_MOCK_SALESFORCE || 'true',
  SALESFORCE_AUTH_MODE: process.env.SALESFORCE_AUTH_MODE || 'OAUTH_PASSWORD',
  SALESFORCE_CLI_TARGET_ORG: process.env.SALESFORCE_CLI_TARGET_ORG || '',
  SALESFORCE_API_VERSION: process.env.SALESFORCE_API_VERSION || '62.0',
  SALESFORCE_LOGIN_URL: process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com',
  SALESFORCE_CLIENT_ID: process.env.SALESFORCE_CLIENT_ID || '',
  SALESFORCE_CLIENT_SECRET: process.env.SALESFORCE_CLIENT_SECRET || '',
  SALESFORCE_USERNAME: process.env.SALESFORCE_USERNAME || '',
  SALESFORCE_PASSWORD: process.env.SALESFORCE_PASSWORD || '',
  SALESFORCE_SECURITY_TOKEN: process.env.SALESFORCE_SECURITY_TOKEN || '',
  SALESFORCE_INSTANCE_URL: process.env.SALESFORCE_INSTANCE_URL || '',
  LIVE_TEST_EMAIL: process.env.LIVE_TEST_EMAIL || '',
  ALLOW_SAFE_SALESFORCE_TEST_WRITES: process.env.ALLOW_SAFE_SALESFORCE_TEST_WRITES || 'false',
  ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK: process.env.ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK || 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  PORT: process.env.PORT || '3000',
};

const result = envSchema.safeParse(rawEnv);

if (!result.success) {
  const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  if (!process.env.VITEST) process.exit(1);
}

export const env = result.success ? result.data : ({
  NODE_ENV: 'development' as const, SLACK_BOT_TOKEN: 'mock-bot-token', SLACK_SIGNING_SECRET: 'mock-signing-secret',
  SLACK_APP_TOKEN: 'mock-app-token', SLACK_SOCKET_MODE: true, USE_MOCK_SALESFORCE: true,
  SALESFORCE_AUTH_MODE: 'OAUTH_PASSWORD' as const, SALESFORCE_CLI_TARGET_ORG: undefined, SALESFORCE_API_VERSION: '62.0',
  SALESFORCE_LOGIN_URL: 'https://login.salesforce.com', SALESFORCE_CLIENT_ID: undefined, SALESFORCE_CLIENT_SECRET: undefined,
  SALESFORCE_USERNAME: undefined, SALESFORCE_PASSWORD: undefined, SALESFORCE_SECURITY_TOKEN: undefined,
  SALESFORCE_INSTANCE_URL: undefined, LIVE_TEST_EMAIL: undefined, ALLOW_SAFE_SALESFORCE_TEST_WRITES: false,
  ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK: true, LOG_LEVEL: 'info' as const, PORT: 3000,
});
export type Env = z.infer<typeof envSchema>;
