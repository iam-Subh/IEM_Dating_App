import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const hasSmtpCredentials = Boolean(
  process.env.SMTP_USER && process.env.SMTP_PASS,
);

// Do not open an SMTP connection in test or local processes that have no credentials.
if (hasSmtpCredentials) {
  transporter
    .verify()
    .then(() => {
      logger.info('SMTP email transporter ready');
    })
    .catch((err) => {
      logger.error('SMTP connection failed:', err);
    });
}

export class EmailService {
  static async sendOTP(to: string, code: string): Promise<void> {
    const from = process.env.SMTP_FROM || 'IEM Connect <noreply@iemconnect.app>';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>IEM Connect Verification</title>
  <style>
    /* Force email clients to respect our dark colors */
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
  </style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #121212; margin: 0; padding: 60px 20px;">
  <div style="max-width: 520px; margin: 0 auto; background-color: #1e1e1e; border-radius: 16px; overflow: hidden; border: 1px solid #333333;">
    
    <!-- Bold Header -->
    <div style="padding: 48px 32px 32px 32px; text-align: center;">
      <h1 style="color: #ffffff; font-size: 32px; margin: 0; font-weight: 800; letter-spacing: 2px;">
        IEM<span style="font-weight: 300; opacity: 0.9;">CONNECT</span>
      </h1>
      <p style="color: #ffb4a2; font-size: 13px; margin: 12px 0 0 0; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase;">Premium Campus Dating</p>
    </div>

    <!-- Body -->
    <div style="padding: 0 40px 48px 40px;">
      <h2 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 16px 0; text-align: center;">Verify your Identity</h2>
      <p style="color: #a1a1aa; font-size: 15px; line-height: 1.6; margin: 0 0 40px 0; text-align: center;">
        Welcome to the club. Use the secure code below to finalize your IEM Connect profile.
      </p>

      <!-- Dark Code Box -->
      <div style="background-color: #121212; border: 1px solid #333333; border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 32px;">
        <div style="font-size: 44px; font-weight: 700; letter-spacing: 20px; color: #ff5722; font-family: 'Courier New', Courier, monospace; margin-left: 20px;">
          ${code}
        </div>
      </div>

      <p style="color: #a1a1aa; font-size: 12px; text-align: center; margin: 0 0 40px 0; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">
        EXPIRES IN <strong style="color: #ffffff;">5 MINUTES</strong>
      </p>

      <!-- Safety block -->
      <div style="background-color: #2a1612; border-left: 4px solid #ff5722; padding: 20px; margin-bottom: 48px; border-radius: 4px;">
        <p style="color: #ffb4a2; font-size: 14px; margin: 0; line-height: 1.6;">
          <strong style="color: #ff8a65;">SECURITY:</strong> IEM Connect staff will <em>never</em> ask you for this code. Do not share it.
        </p>
      </div>

      <!-- Footer -->
      <div style="border-top: 1px solid #333333; padding-top: 24px; text-align: center;">
        <p style="color: #71717a; font-size: 12px; line-height: 1.5; margin: 0;">
          If you didn't request this email, safely ignore it.<br><br>
          &copy; ${new Date().getFullYear()} IEM Connect. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    try {
      await transporter.sendMail({
        from,
        to,
        subject: `${code} — Your IEM Connect Verification Code`,
        html,
        text: `Your IEM Connect verification code is: ${code}\n\nThis code expires in 5 minutes.\n\nIf you didn't request this, ignore this email.`,
      });
      logger.info('OTP email sent');
    } catch (error) {
      logger.error('Failed to send OTP email');
      throw new Error('Failed to send verification email. Please try again.');
    }
  }

  /** The confirmation link for deleting an account from the website (public-pages.routes.ts). */
  static async sendAccountDeletionLink(to: string, link: string): Promise<void> {
    const from = process.env.SMTP_FROM || 'IEM Connect <noreply@iemconnect.app>';
    if (!hasSmtpCredentials) {
      // Local development without mail: the link goes to the log instead.
      logger.info(`[DELETE] confirmation link (no SMTP configured): ${link}`);
      return;
    }
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#121212;margin:0;padding:48px 20px">
<div style="max-width:520px;margin:0 auto;background:#1e1e1e;border-radius:16px;border:1px solid #333;padding:36px">
<h1 style="color:#fff;font-size:22px;margin:0 0 12px">Delete your IEM Connect account?</h1>
<p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 24px">We got a request to delete the account that uses this email. If it was you, confirm below. The link works for 60 minutes.</p>
<a href="${link}" style="display:inline-block;background:#f3c1ca;color:#331c23;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:24px">Confirm deletion</a>
<p style="color:#71717a;font-size:13px;line-height:1.6;margin:24px 0 0">If you didn't ask for this, ignore this email - nothing changes.</p>
</div></body></html>`;
    await transporter.sendMail({
      from, to,
      subject: 'Confirm deleting your IEM Connect account',
      html,
      text: `We got a request to delete your IEM Connect account. To confirm, open this link within 60 minutes:
${link}

If you didn't ask for this, ignore this email.`,
    });
  }

  /** A short plain message from the team (an appeal decision). */
  static async sendTeamMessage(to: string, subject: string, text: string): Promise<void> {
    const from = process.env.SMTP_FROM || 'IEM Connect <noreply@iemconnect.app>';
    if (!hasSmtpCredentials) { logger.info(`[EMAIL] (no SMTP configured) to ${to}: ${subject}`); return; }
    await transporter.sendMail({ from, to, subject, text });
  }
}
