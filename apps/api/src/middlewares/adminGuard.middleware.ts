import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../utils/ApiResponse';

/**
 * Staff roles (ADMIN_PANEL_PLAN.md 1). Every request reads the role from the
 * database (access-session.service.ts), so a change applies at once.
 *
 * - owner: everything, including giving roles - the superuser.
 * - admin: everything except giving roles.
 * - moderator: reviews, reports, and acting on accounts (warn to ban).
 * - support: looks people up, signs them out, sends a warning.
 */
export const STAFF_ROLES = ['owner', 'admin', 'moderator', 'support'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Permission =
  | 'dashboard' | 'reviews' | 'reports' | 'users.read'
  | 'users.support' | 'users.act' | 'users.ban' | 'roles' | 'audit' | 'settings';

const ALL: Permission[] = ['dashboard', 'reviews', 'reports', 'users.read', 'users.support', 'users.act', 'users.ban', 'roles', 'audit', 'settings'];
export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: ALL,
  admin: ALL.filter((permission) => permission !== 'roles'),
  moderator: ['dashboard', 'reviews', 'reports', 'users.read', 'users.support', 'users.act', 'users.ban'],
  support: ['dashboard', 'users.read', 'users.support'],
};

export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === 'string' && (STAFF_ROLES as readonly string[]).includes(role);
}

export function can(role: unknown, permission: Permission) {
  return isStaffRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * The original admin-only routes (algorithm, metrics, settings): owner or admin.
 * Must be used AFTER the `protect` middleware (which sets req.user).
 */
export const adminGuard = (req: Request, res: Response, next: NextFunction): void => {
  const role = (req as any).user?.role;
  if (role !== 'owner' && role !== 'admin') {
    res.status(403).json(ApiResponse.error('Forbidden: Admin access required'));
    return;
  }
  next();
};

/** A panel route open to every staff role that has `permission`. */
export const staffGuard = (permission: Permission) => (req: Request, res: Response, next: NextFunction): void => {
  if (!can((req as any).user?.role, permission)) {
    res.status(403).json(ApiResponse.error('Forbidden: your role cannot do this', 'STAFF_FORBIDDEN'));
    return;
  }
  next();
};
