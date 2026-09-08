import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiResponse } from '../utils/ApiResponse';
import { HttpError } from '../utils/httpError';

export const globalErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, message: err.message, code: err.code });
    return;
  }
  logger.error(`Error processing ${req.method} ${req.path}: ${err.message}`, { stack: err.stack });
  res.status(500).json(ApiResponse.error('Internal Server Error'));
};
