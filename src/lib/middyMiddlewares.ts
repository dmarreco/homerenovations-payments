/**
 * Shared Middy middlewares: correlation ID, request/response logging (INFO + TRACE), and HTTP error handling.
 */

import middy, { type MiddlewareObj } from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import type { Context as LambdaContext } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const LOG_LEVEL = process.env.LOG_LEVEL?.toLowerCase() ?? 'info';
const isTrace = LOG_LEVEL === 'trace';

/** Context extended with correlationId (set by our middleware). */
export interface MiddyContext extends LambdaContext {
  correlationId?: string;
}

function getCorrelationIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  // API Gateway
  const headers = e.headers as Record<string, string> | undefined;
  if (headers) {
    const id = headers['X-Correlation-Id'] ?? headers['x-correlation-id'];
    if (id && typeof id === 'string') return id;
    const ctx = e.requestContext as { requestId?: string } | undefined;
    if (ctx?.requestId) return ctx.requestId;
  }
  // SQS
  const records = e.Records as Array<{ messageId?: string }> | undefined;
  if (Array.isArray(records) && records.length > 0 && records[0].messageId) {
    return records[0].messageId;
  }
  return null;
}

function isHttpEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;
  return 'requestContext' in e && 'headers' in e;
}

/** Correlation ID middleware: set from header/requestId/SQS or generate; add to HTTP response headers. */
export const correlationIdMiddleware = (): MiddlewareObj<unknown, unknown, Error> => {
  return {
    before: async (request) => {
      const event = request.event as unknown;
      const ctx = request.context as unknown as MiddyContext;
      const id = getCorrelationIdFromEvent(event) ?? uuidv4();
      ctx.correlationId = id;
    },
    after: async (request) => {
      const response = request.response as Record<string, unknown> | undefined;
      if (!response || typeof response !== 'object') return;
      if (!isHttpEvent(request.event)) return;
      const ctx = request.context as unknown as MiddyContext;
      const correlationId = ctx.correlationId;
      if (!correlationId) return;
      const headers = (response.headers as Record<string, string>) ?? {};
      headers['X-Correlation-Id'] = correlationId;
      response.headers = headers;
    },
  };
};

/** Request/response logger: INFO = static message, TRACE = full event/response (when LOG_LEVEL=trace). */
export function requestResponseLoggerMiddleware(functionName: string): MiddlewareObj<unknown, unknown, Error> {
  return {
    before: async (request) => {
      const ctx = request.context as unknown as MiddyContext;
      const name = functionName || ctx.functionName || 'lambda';
      const correlationId = ctx.correlationId ?? '';
      console.info(JSON.stringify({ level: 'INFO', message: 'Lambda invoked', functionName: name, correlationId }));
      if (isTrace) {
        console.info(JSON.stringify({ level: 'TRACE', message: 'Lambda request', functionName: name, correlationId, event: request.event }));
      }
    },
    after: async (request) => {
      const ctx = request.context as unknown as MiddyContext;
      const name = functionName || ctx.functionName || 'lambda';
      const correlationId = ctx.correlationId ?? '';
      console.info(JSON.stringify({ level: 'INFO', message: 'Lambda completed', functionName: name, correlationId }));
      if (isTrace) {
        console.info(JSON.stringify({ level: 'TRACE', message: 'Lambda response', functionName: name, correlationId, response: request.response }));
      }
    },
  };
}

/** Wrap an API Gateway handler with correlation ID, logger, and HTTP error handler. */
export function withMiddyHttp<E = unknown, R = unknown>(
  handler: (event: E, context: MiddyContext) => Promise<R>,
  functionName?: string
) {
  const name = functionName ?? 'http';
  return middy(handler as (event: E, context: LambdaContext) => Promise<R>)
    .use(correlationIdMiddleware())
    .use(requestResponseLoggerMiddleware(name))
    .use(httpErrorHandler({ fallbackMessage: 'Internal server error' }));
}

/** Wrap a non-HTTP handler (SQS, EventBridge, Stream, Scheduled) with correlation ID and logger. */
export function withMiddy<E = unknown, R = unknown>(
  handler: (event: E, context: MiddyContext) => Promise<R>,
  functionName?: string
) {
  const name = functionName ?? 'lambda';
  return middy(handler as (event: E, context: LambdaContext) => Promise<R>)
    .use(correlationIdMiddleware())
    .use(requestResponseLoggerMiddleware(name));
}
