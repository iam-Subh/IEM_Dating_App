import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

/**
 * The admin audit log (ADMIN_PANEL_PLAN.md 1): every change a staff member
 * makes - who, what, on whom, when, and whether it worked. Mounted on the
 * admin routers, so no admin action can skip it. Reads are not logged.
 *
 * A route can name its action (`auditAs`); otherwise the method and path are kept.
 */
const SECRET_KEYS = /password|token|secret/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 3) return '…';
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[hidden]' : scrub(item, depth + 1)]));
  }
  return value;
}

export function auditAs(action: string, targetType: string, targetParam = 'id') {
  return (req: Request, res: Response, next: NextFunction) => {
    res.locals.audit = { action, targetType, targetId: req.params[targetParam] ? String(req.params[targetParam]) : null };
    next();
  };
}

export function adminAudit(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    const adminId = (req as any).user?.sub;
    if (!adminId) return; // refused before sign-in: nothing was done
    const named = res.locals.audit as { action: string; targetType: string; targetId: string | null } | undefined;
    const path = (req.baseUrl + (req.route?.path ?? req.path)).replace('/api/v1', '');
    void prisma.adminAuditLog.create({
      data: {
        adminId,
        action: (named?.action ?? `${req.method} ${path}`).slice(0, 80),
        targetType: named?.targetType ?? null,
        targetId: String(named?.targetId ?? req.params.id ?? req.params.userId ?? '').slice(0, 80) || null,
        details: scrub({ body: req.body ?? {}, path: req.originalUrl.split('?')[0] }) as object,
        statusCode: res.statusCode,
        ip: (req.ip ?? '').slice(0, 64) || null,
      },
    }).catch((error) => logger.warn(`[ADMIN] audit entry not saved: ${(error as Error).message}`));
  });
  next();
}
