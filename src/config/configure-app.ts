import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { json, raw, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Environment } from './environment';
import { ApiExceptionFilter, errorResponse } from '../common/errors/api-exception.filter';
import { ApiError } from '../common/errors/api-error';
import { ApiRequest } from '../auth/auth.decorators';

export function configureApp(app: INestApplication): void {
  const env = app.get(Environment);
  const logger = new Logger('HTTP');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((req: ApiRequest, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    const start = Date.now();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('X-Unitflow-Backend', 'nestjs');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.once('finish', () =>
      logger.log(
        JSON.stringify({
          event: 'request',
          requestId: req.requestId,
          status: res.statusCode,
          method: req.method,
          path: req.path,
          durationMs: Date.now() - start,
        }),
      ),
    );
    const origin = req.headers.origin;
    if (origin && !env.allowedOrigins.has(origin)) {
      const result = errorResponse(
        new ApiError(403, 'forbidden', 'This web address is not allowed. Check ALLOWED_ORIGINS.'),
        req.requestId,
      );
      res.status(result.status).json(result.body);
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Unitflow-House');
      res.setHeader('Access-Control-Expose-Headers', 'X-Unitflow-Backend,X-Request-Id');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  const jsonParser = json({ limit: 16384, strict: false, inflate: false });
  const imageParser = raw({
    type: () => true,
    limit: 4 * 1024 * 1024,
    inflate: false,
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
      next();
      return;
    }
    if (req.method === 'POST' && /^\/v1\/units\/[^/]+\/photos\/?$/.test(req.path)) {
      imageParser(req, res, next);
      return;
    }
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      next(new ApiError(415, 'content_type', 'Send application/json.'));
      return;
    }
    jsonParser(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        next(new ApiError(400, 'invalid_input', 'Send a JSON object.'));
        return;
      }
      next();
    });
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new ApiError(
          400,
          'invalid_input',
          errors.some((e) => e.constraints?.whitelistValidation)
            ? 'The request contains unsupported fields.'
            : 'Check the request fields and their types.',
        ),
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}
