import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ApiError } from './api-error';
import { ApiRequest } from '../../auth/auth.decorators';
export function errorResponse(
  error: unknown,
  requestId: string,
): { status: number; body: { error: { code: string; message: string; requestId: string } } } {
  if (error instanceof ApiError)
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, requestId } },
    };
  const type = (error as { type?: string })?.type;
  if (type === 'entity.too.large')
    return errorResponse(new ApiError(413, 'too_large', 'The request is too large.'), requestId);
  if (type === 'entity.parse.failed')
    return errorResponse(new ApiError(400, 'invalid_json', 'Check the request format.'), requestId);
  if (type === 'encoding.unsupported' || type === 'charset.unsupported')
    return errorResponse(
      new ApiError(415, 'content_type', 'Use uncompressed UTF-8 request data.'),
      requestId,
    );
  if (error instanceof HttpException && error.getStatus() === 404)
    return errorResponse(new ApiError(404, 'not_found', 'Endpoint not found.'), requestId);
  // Nest's Express adapter wraps external SyntaxError before invoking filters.
  if (error instanceof HttpException && error.getStatus() === 400)
    return errorResponse(new ApiError(400, 'invalid_json', 'Check the request format.'), requestId);
  return {
    status: 503,
    body: {
      error: {
        code: 'temporarily_unavailable',
        message: 'The service is temporarily unavailable. Please try again.',
        requestId,
      },
    },
  };
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<ApiRequest>();
    const res = host.switchToHttp().getResponse<Response>();
    const result = errorResponse(error, req.requestId);
    if (result.status === 503)
      this.logger.error(
        JSON.stringify({
          event: 'request_failed',
          requestId: req.requestId,
          errorType: error instanceof Error ? error.name : 'Unknown',
        }),
      );
    if (result.status === 429) res.setHeader('Retry-After', '60');
    res.status(result.status).json(result.body);
  }
}
