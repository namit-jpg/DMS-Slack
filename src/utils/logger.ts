import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';

const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

export function createChildLogger(component: string, correlationId?: string) {
  return logger.child({
    component,
    correlationId: correlationId || uuidv4(),
  });
}

export { logger };
export type Logger = pino.Logger;
