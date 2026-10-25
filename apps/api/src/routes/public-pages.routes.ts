import { Router, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authRateLimiter } from '../middlewares/rateLimit.middleware';
import { legalConfig, legalDocument, legalIndex, LEGAL_UPDATED, type LegalBlock } from '../legal/documents';
import { AuthService } from '../services/auth.service';
import { AccountLifecycleService } from '../services/account-lifecycle.service';
import { EmailService } from '../services/email.service';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

/**
 * Public web pages, no sign-in (docs/SAFETY_AND_LEGAL.md 4.1, 6): the legal
 * documents for the stores and the website to link to, and account deletion
 * without the app - which Google Play requires. Deletion is confirmed by a
 * link sent to the account's email, so nobody can delete someone else's.
 */
const router = Router();
const AUDIENCE = 'iem-connect:account-deletion';
const LINK_MINUTES = 60;

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
/** Escaped text with email addresses and web links made clickable. */
const linked = (text: string) => escape(text)
  .replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, '<a href="mailto:$1">$1</a>')
  .replace(/\b(cybercrime\.gov\.in)\b/g, '<a href="https://$1" rel="noopener">$1</a>');

function page(res: Response, title: string, body: string, status = 200) {
  res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light"><title>${escape(title)} · IEM Connect</title>
<style>
:root{--bg:#100f0d;--panel:#1a181b;--text:#f6f4f6;--muted:#bdb7c0;--line:rgba(255,255,255,.08);--accent:#f3c1ca;--ink:#331c23}
@media (prefers-color-scheme:light){:root{--bg:#f6f4f2;--panel:#fff;--text:#1b1519;--muted:#5d5157;--line:rgba(0,0,0,.08);--accent:#8a3155;--ink:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{border-bottom:1px solid var(--line)}.bar{max-width:760px;margin:0 auto;padding:16px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.brand{font-weight:700;color:var(--text);text-decoration:none}.bar nav{display:flex;gap:14px;flex-wrap:wrap;font-size:14px}.bar nav a{color:var(--muted);text-decoration:none}
main{max-width:760px;margin:0 auto;padding:28px 20px 60px}h1{font-size:30px;line-height:1.2;margin:0 0 6px}h2{font-size:19px;margin:30px 0 8px}
.meta{color:var(--muted);font-size:14px}p,li{color:var(--muted)}li{margin:4px 0}a{color:var(--accent)}
.note{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;color:var(--text)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin:12px 0;display:block;text-decoration:none}
.card strong{color:var(--text)}.card span{display:block;color:var(--muted);font-size:14px;margin-top:2px}
input{width:100%;height:46px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:16px}
button{height:46px;padding:0 20px;border:0;border-radius:23px;background:var(--accent);color:var(--ink);font-weight:700;font-size:15px;cursor:pointer;margin-top:12px}
footer{max-width:760px;margin:0 auto;padding:0 20px 40px;color:var(--muted);font-size:13px}
</style></head><body>
<header><div class="bar"><a class="brand" href="/legal">IEM Connect</a><nav><a href="/legal/terms">Terms</a><a href="/legal/privacy">Privacy</a><a href="/legal/guidelines">Guidelines</a><a href="/legal/safety">Safety</a><a href="/legal/grievance">Grievances</a><a href="/account/delete">Delete account</a><a href="/appeal">Appeal</a></nav></div></header>
<main>${body}</main>
<footer>Contact: <a href="mailto:${escape(legalConfig().supportEmail)}">${escape(legalConfig().supportEmail)}</a></footer>
</body></html>`);
}

const block = (item: LegalBlock) => (item.type === 'list'
  ? `<ul>${item.items.map((text) => `<li>${linked(text)}</li>`).join('')}</ul>`
  : item.type === 'note' ? `<p class="note">${linked(item.text)}</p>` : `<p>${linked(item.text)}</p>`);

router.get('/legal', (_req, res) => {
  page(res, 'Legal and safety', `<h1>Legal and safety</h1><p class="meta">Last updated ${LEGAL_UPDATED}</p>
${legalIndex().map((doc) => `<a class="card" href="/legal/${doc.slug}"><strong>${escape(doc.title)}</strong><span>${escape(doc.summary)}</span></a>`).join('')}
<a class="card" href="/account/delete"><strong>Delete your account</strong><span>Ask for your account and data to be deleted, without the app.</span></a>`);
});

router.get('/legal/:slug', (req, res) => {
  const doc = legalDocument(String(req.params.slug));
  if (!doc) return page(res, 'Not found', '<h1>Not found</h1><p><a href="/legal">All documents</a></p>', 404);
  page(res, doc.title, `<h1>${escape(doc.title)}</h1><p class="meta">Last updated ${doc.updated}</p>
${doc.sections.map((section) => `<h2>${escape(section.heading)}</h2>${section.blocks.map(block).join('')}`).join('')}`);
});

// --- Account deletion without the app ------------------------------------------

const deletionIntro = `<h1>Delete your account</h1>
<p>You can delete your account in the app: <strong>Settings › Account and data › Delete account</strong>. If you can't use the app, ask here.</p>
<p>We email a confirmation link to the address on your account. After you confirm, your profile is hidden at once and everything is erased after 30 days. Signing in within those 30 days lets you keep the account.</p>`;

router.get('/account/delete', (_req, res) => {
  page(res, 'Delete your account', `${deletionIntro}
<form method="post" action="/account/delete"><label for="email" class="meta">Your account email (or college email)</label>
<input id="email" name="email" type="email" required autocomplete="email"><button type="submit">Email me a confirmation link</button></form>`);
});

router.post('/account/delete', authRateLimiter, async (req, res) => {
  const email = z.string().email().max(254).safeParse(String(req.body?.email ?? '').trim());
  const done = () => page(res, 'Check your email', `<h1>Check your email</h1><p>If an account uses that address, we've sent it a link to confirm the deletion. The link works for ${LINK_MINUTES} minutes.</p>`);
  if (!email.success) return page(res, 'Delete your account', `${deletionIntro}<p class="note">Enter a valid email address.</p><p><a href="/account/delete">Try again</a></p>`, 400);
  try {
    const user = await AuthService.findAccountByEmail(email.data);
    // The same answer either way: the page never says which emails have accounts.
    if (user && user.email && ['active', 'deletion_pending', 'restricted', 'suspended'].includes(user.accountStatus)) {
      const token = jwt.sign({ sub: user.id, sv: user.sessionVersion }, process.env.JWT_ACCESS_SECRET as string, { audience: AUDIENCE, expiresIn: `${LINK_MINUTES}m` });
      await EmailService.sendAccountDeletionLink(email.data, `${legalConfig().publicUrl}/account/delete/confirm?token=${encodeURIComponent(token)}`);
    }
  } catch (error) {
    logger.warn(`[DELETE] web request failed: ${(error as Error).message}`);
  }
  done();
});

function readToken(token: unknown) {
  try {
    return jwt.verify(String(token ?? ''), process.env.JWT_ACCESS_SECRET as string, { audience: AUDIENCE }) as { sub: string; sv: number };
  } catch {
    return null;
  }
}

router.get('/account/delete/confirm', (req, res) => {
  const token = readToken(req.query.token);
  if (!token) return page(res, 'Link expired', '<h1>This link has expired</h1><p><a href="/account/delete">Ask for a new one</a>.</p>', 400);
  page(res, 'Confirm deletion', `<h1>Delete your account?</h1><p>Your profile is hidden at once and you are signed out everywhere. Everything is erased after 30 days.</p>
<form method="post" action="/account/delete/confirm"><input type="hidden" name="token" value="${escape(String(req.query.token))}"><button type="submit">Delete my account</button></form>`);
});

router.post('/account/delete/confirm', authRateLimiter, async (req, res) => {
  const token = readToken(req.body?.token);
  if (!token) return page(res, 'Link expired', '<h1>This link has expired</h1><p><a href="/account/delete">Ask for a new one</a>.</p>', 400);
  try {
    const request = await AccountLifecycleService.requestDeletion(token.sub, { reason: 'web_request' });
    const day = request.scheduledFor ? new Date(request.scheduledFor).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'in 30 days';
    page(res, 'Account deletion requested', `<h1>Your account will be deleted</h1><p>It is hidden now and will be erased on ${escape(day)}. To keep it, sign in to the app before then.</p>`);
  } catch (error) {
    logger.warn(`[DELETE] web confirm failed: ${(error as Error).message}`);
    page(res, 'Something went wrong', `<h1>That didn't work</h1><p>Try again, or write to <a href="mailto:${escape(legalConfig().supportEmail)}">${escape(legalConfig().supportEmail)}</a>.</p>`, 500);
  }
});

// --- Appeals: for people who can't sign in (docs/SAFETY_PROCESSES.md, Appeals) --------

router.get('/appeal', (_req, res) => {
  page(res, 'Appeal a decision', `<h1>Appeal a decision</h1>
<p>If your account was put on hold, suspended or banned and you think we made a mistake, tell us here. Our team reads every appeal and replies by email within 15 days.</p>
<form method="post" action="/appeal">
<label for="email" class="meta">The email on your account</label><input id="email" name="email" type="email" required autocomplete="email">
<label for="message" class="meta" style="display:block;margin-top:14px">What happened, and why you think the decision is wrong</label>
<textarea id="message" name="message" required maxlength="2000" rows="7" style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);font:inherit"></textarea>
<button type="submit">Send appeal</button></form>`);
});

router.post('/appeal', authRateLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(254), message: z.string().trim().min(10).max(2000) }).safeParse(req.body ?? {});
  if (!parsed.success) return page(res, 'Appeal a decision', '<h1>Appeal a decision</h1><p class="note">Add your email and at least a sentence about what happened.</p><p><a href="/appeal">Try again</a></p>', 400);
  try {
    const user = await AuthService.findAccountByEmail(parsed.data.email);
    // One open appeal per account; another message adds to it.
    const open = user ? await prisma.appeal.findFirst({ where: { userId: user.id, status: 'pending' } }) : null;
    if (open) await prisma.appeal.update({ where: { id: open.id }, data: { message: `${open.message}

---
${parsed.data.message}`.slice(0, 2000) } });
    else await prisma.appeal.create({ data: { userId: user?.id ?? null, email: parsed.data.email.toLowerCase(), message: parsed.data.message } });
  } catch (error) {
    logger.warn(`[APPEAL] not saved: ${(error as Error).message}`);
  }
  page(res, 'Appeal received', '<h1>We got your appeal</h1><p>Our team will look at it and reply to your email within 15 days.</p>');
});

export default router;
