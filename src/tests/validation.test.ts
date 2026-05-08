import { describe, it, expect } from 'vitest';
import { validateAndParse } from '../utils/validation';
import { ValidationError } from '../utils/errors';
import { isSuccess, isFailure } from '../utils/result';
import { z } from 'zod';

describe('Validation', () => {
  it('validates and parses valid data', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = validateAndParse(schema, { name: 'John', age: 30 });
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.name).toBe('John');
    }
  });

  it('returns error for invalid data', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = validateAndParse(schema, { name: 'John', age: 'not-a-number' });
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });
});
