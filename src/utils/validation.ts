import { z, ZodSchema } from 'zod';
import { ValidationError } from './errors';
import { Result, success, failure } from './result';
import { Logger } from './logger';

export function validateAndParse<T>(
  schema: ZodSchema<T>,
  data: unknown,
  logger?: Logger,
): Result<T, ValidationError> {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');

    logger?.warn({ issues: parsed.error.issues }, 'Validation failed');

    return { success: false, error: new ValidationError(message) };
  }

  return { success: true, data: parsed.data };
}

export function sanitizeSalesforceId(id: string): string {
  return id.substring(0, 18);
}

export function isValidSalesforceId(id: string): boolean {
  return /^[a-zA-Z0-9]{15,18}$/.test(id);
}

export function sanitizeSlackInput(input: string): string {
  return input.replace(/[<>]/g, '').trim();
}
