import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ApiResponse } from '../utils/ApiResponse';

export const validateRequest = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as { body?: unknown; params?: Record<string, string> };
      if (parsed.body !== undefined) req.body = parsed.body;
      if (parsed.params !== undefined) Object.assign(req.params, parsed.params);
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json(
          ApiResponse.error('Validation failed', JSON.stringify(error.issues))
        );
      }
      return next(error);
    }
  };
};
