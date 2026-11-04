import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const path = String(httpAdapter.getRequestUrl(request));

    const body =
      exception instanceof HttpException
        ? this.fromHttpException(exception, path)
        : this.fromUnknown(exception, path);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${httpAdapter.getRequestMethod(request)} ${path} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    httpAdapter.reply(ctx.getResponse(), body, body.statusCode);
  }

  private fromHttpException(
    exception: HttpException,
    path: string,
  ): ErrorResponseBody {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const details =
      typeof response === 'object' && response !== null
        ? (response as { message?: string | string[]; error?: string })
        : { message: response };

    return {
      statusCode,
      error: details.error ?? exception.name,
      message: details.message ?? exception.message,
      path,
      timestamp: new Date().toISOString(),
    };
  }

  private fromUnknown(_exception: unknown, path: string): ErrorResponseBody {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Internal server error',
      path,
      timestamp: new Date().toISOString(),
    };
  }
}
