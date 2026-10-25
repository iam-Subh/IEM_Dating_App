import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middlewares/auth.middleware';
import { can, staffGuard } from '../middlewares/adminGuard.middleware';
import { adminAudit, auditAs } from '../middlewares/adminAudit.middleware';
import { ApiResponse } from '../utils/ApiResponse';
import { ACTION_PERMISSION, AdminPanelService, type AccountAction } from '../services/admin-panel.service';
import { SafetyService } from '../services/safety.service';
import { MediaModerationService } from '../services/media-moderation.service';
import { FeedbackService, REPORT_STATUSES } from '../services/feedback.service';

/** The admin panel's routes (ADMIN_PANEL_PLAN.md), under /api/v1/admin/panel. */
const router = Router();
router.use(protect, adminAudit);

router.get('/me', staffGuard('dashboard'), async (req, res, next) => {
  try { res.json(ApiResponse.success(await AdminPanelService.me((req as any).user))); } catch (error) { next(error); }
});

router.get('/dashboard', staffGuard('dashboard'), async (_req, res, next) => {
  try { res.json(ApiResponse.success(await AdminPanelService.dashboard())); } catch (error) { next(error); }
});

router.get('/users', staffGuard('users.read'), async (req, res, next) => {
  try { res.json(ApiResponse.success(await AdminPanelService.searchUsers(String(req.query.q ?? '')))); } catch (error) { next(error); }
});

router.get('/users/:id', staffGuard('users.read'), async (req, res, next) => {
  try { res.json(ApiResponse.success(await AdminPanelService.user(String(req.params.id)))); } catch (error) { next(error); }
});

const actionSchema = z.object({
  action: z.enum(['warn', 'logout_all', 'restrict', 'restore', 'suspend', 'unsuspend', 'ban', 'remove_photo', 'reset_selfie', 'set_role']),
  reason: z.string().max(300).optional(),
  days: z.number().int().min(1).max(365).optional(),
  photoId: z.string().uuid().optional(),
  role: z.string().max(20).optional(),
}).strict();

router.post('/users/:id/actions', staffGuard('users.read'), async (req, res, next) => {
  try {
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid action'));
    const action = parsed.data.action as AccountAction;
    if (!can((req as any).user.role, ACTION_PERMISSION[action])) return res.status(403).json(ApiResponse.error('Your role cannot do this', 'STAFF_FORBIDDEN'));
    res.locals.audit = { action: `user.${action}`, targetType: 'user', targetId: String(req.params.id) };
    res.json(ApiResponse.success(await AdminPanelService.act((req as any).user.sub, String(req.params.id), parsed.data)));
  } catch (error) { next(error); }
});

router.get('/cases', staffGuard('reports'), async (req, res, next) => {
  try { res.json(ApiResponse.success(await AdminPanelService.cases(req.query.status === 'closed' ? 'closed' : 'open'))); } catch (error) { next(error); }
});

const caseSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  accountAction: z.enum(['none', 'restrict', 'ban', 'restore']).optional(),
  resolution: z.string().min(1).max(2000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

router.patch('/cases/:id', staffGuard('reports'), auditAs('case.update', 'case'), async (req, res, next) => {
  try {
    const parsed = caseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid case update'));
    if (parsed.data.accountAction === 'ban' && !can((req as any).user.role, 'users.ban')) return res.status(403).json(ApiResponse.error('Your role cannot ban', 'STAFF_FORBIDDEN'));
    res.json(ApiResponse.success(await SafetyService.updateCase(String(req.params.id), (req as any).user.sub, parsed.data)));
  } catch (error) { next(error); }
});

router.get('/appeals', staffGuard('reports'), async (req, res, next) => {
  try { res.json(ApiResponse.success(await AdminPanelService.appeals(req.query.status === 'closed' ? 'closed' : 'pending'))); } catch (error) { next(error); }
});
router.post('/appeals/:id/decide', staffGuard('users.act'), auditAs('appeal.decide', 'appeal'), async (req, res, next) => {
  try {
    const parsed = z.object({ decision: z.enum(['restore', 'uphold']), note: z.string().trim().min(3).max(500) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('A decision and a note the person will read'));
    res.json(ApiResponse.success(await AdminPanelService.decideAppeal((req as any).user.sub, (req as any).user.role, String(req.params.id), parsed.data)));
  } catch (error) { next(error); }
});

// The nudity check's borderline uploads (docs/NUDITY_CHECK.md).
router.get('/media', staffGuard('reviews'), async (req, res, next) => {
  try { res.json(ApiResponse.success(await MediaModerationService.list(req.query.status === 'closed' ? 'closed' : 'pending'))); } catch (error) { next(error); }
});
router.post('/media/:id/decide', staffGuard('reviews'), auditAs('media.decide', 'media'), async (req, res, next) => {
  try {
    const parsed = z.object({ decision: z.enum(['approve', 'remove']), note: z.string().max(300).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('approve or remove'));
    res.json(ApiResponse.success(await MediaModerationService.decide((req as any).user.sub, String(req.params.id), parsed.data)));
  } catch (error) { next(error); }
});

// Bug reports and the in-app rating (docs/FEEDBACK.md).
router.get('/bug-reports', staffGuard('users.support'), async (req, res, next) => {
  try { res.json(ApiResponse.success(await FeedbackService.list({ status: req.query.status ? String(req.query.status) : undefined, area: req.query.area ? String(req.query.area) : undefined }))); }
  catch (error) { next(error); }
});
router.get('/bug-reports/:id', staffGuard('users.support'), async (req, res, next) => {
  try { res.json(ApiResponse.success(await FeedbackService.detail(String(req.params.id)))); } catch (error) { next(error); }
});
router.post('/bug-reports/:id/status', staffGuard('users.support'), auditAs('bug_report.status', 'bug_report'), async (req, res, next) => {
  try {
    const parsed = z.object({
      status: z.enum(REPORT_STATUSES.filter((status) => status !== 'received') as ['investigating', 'fixed', 'closed', 'duplicate']),
      fixedInVersion: z.string().max(30).nullish(), note: z.string().max(500).nullish(), duplicateOf: z.string().max(20).nullish(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Choose a status'));
    res.json(ApiResponse.success(await FeedbackService.setStatus(String(req.params.id), parsed.data)));
  } catch (error) { next(error); }
});
router.get('/ratings', staffGuard('dashboard'), async (_req, res, next) => {
  try { res.json(ApiResponse.success(await FeedbackService.ratings())); } catch (error) { next(error); }
});

router.get('/audit', staffGuard('audit'), async (req, res, next) => {
  try {
    res.json(ApiResponse.success(await AdminPanelService.audit(Number(req.query.limit) || 100, typeof req.query.before === 'string' ? req.query.before : undefined)));
  } catch (error) { next(error); }
});

export default router;
