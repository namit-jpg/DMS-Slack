export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function failure<E = Error>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isSuccess<T, E>(
  result: Result<T, E>,
): result is { success: true; data: T } {
  return result.success === true;
}

export function isFailure<T, E>(
  result: Result<T, E>,
): result is { success: false; error: E } {
  return result.success === false;
}

export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (isSuccess(result)) {
    return result.data;
  }
  throw result.error;
}

export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isSuccess(result)) {
    return result.data;
  }
  return defaultValue;
}
