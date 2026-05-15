// Transactional email via Resend.
//
// Env vars (set in Railway):
//   RESEND_API_KEY        re_xxx (required to actually send)
//   EMAIL_FROM            verified sending address, e.g. "hello@curvycooking.com"
//   EMAIL_FROM_NAME       optional display name, e.g. "Ashley at Curvy Cooking"
//   EMAIL_REPLY_TO        optional reply-to (defaults to EMAIL_FROM)
//
// If RESEND_API_KEY isn't set, sendEmail() logs the would-be email instead
// of failing. Useful for local dev and as a safety net.

import { Resend } from "resend";

const {
  RESEND_API_KEY,
  EMAIL_FROM = "hello@curvycooking.com",
  EMAIL_FROM_NAME = "Curvy Cooking",
  EMAIL_REPLY_TO,
} = process.env;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function fromHeader() {
  return EMAIL_FROM_NAME ? `${EMAIL_FROM_NAME} <${EMAIL_FROM}>` : EMAIL_FROM;
}

/**
 * Send a transactional email.
 * @param {object} opts
 * @param {string} opts.to        Recipient email
 * @param {string} opts.subject   Subject line
 * @param {string} opts.html      HTML body
 * @param {string} opts.text      Plain-text body (REQUIRED for deliverability)
 * @param {object} [logger]       Fastify logger to use; falls back to console
 * @returns {Promise<{ok:boolean, id?:string, error?:string}>}
 */
export async function sendEmail({ to, subject, html, text }, logger = console) {
  if (!resend) {
    logger.warn(`[email] RESEND_API_KEY not set. Would have sent: ${subject} → ${to}\n${text}`);
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const res = await resend.emails.send({
      from: fromHeader(),
      to: [to],
      subject,
      html,
      text,
      ...(EMAIL_REPLY_TO ? { replyTo: EMAIL_REPLY_TO } : {}),
    });
    if (res.error) {
      logger.error?.({ err: res.error }, "Resend error") || logger.error?.(res.error);
      return { ok: false, error: res.error?.message || "Send failed" };
    }
    logger.info?.({ id: res.data?.id, to }, "email sent") || logger.log?.("email sent", res.data?.id);
    return { ok: true, id: res.data?.id };
  } catch (err) {
    logger.error?.({ err: err.message }, "email send threw") || logger.error?.(err);
    return { ok: false, error: err.message };
  }
}

// ---------- Templates ---------------------------------------------------

const BRAND_COLOR = "#7a5cff";
const ACCENT_COLOR = "#ff5db1";
const BG = "#07060f";
const SURFACE = "#14112e";
const INK = "#ffffff";
const INK_DIM = "#b9b3d6";

// Minimal HTML email shell. Works in Gmail, Apple Mail, Outlook.
function shell(innerHtml) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${BG};font-family:-apple-system,'Inter',Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BG};padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:${SURFACE};border-radius:16px;overflow:hidden;">
        <tr><td style="padding:36px 32px 12px;">
          <div style="font-size:14px;color:${INK_DIM};letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">🌶️ Curvy Cooking</div>
        </td></tr>
        ${innerHtml}
        <tr><td style="padding:24px 32px 32px;border-top:1px solid rgba(255,255,255,0.06);color:${INK_DIM};font-size:13px;line-height:1.6;">
          Reply to this email if anything's off. We read every message.<br>
          <span style="color:#6e6982;">curvycooking.com · made with love and red sauce</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function btn(href, label) {
  return `<a href="${href}" style="display:inline-block;background:linear-gradient(90deg,#ff7a3d 0%,${ACCENT_COLOR} 50%,${BRAND_COLOR} 100%);color:${INK};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px;box-shadow:0 8px 24px -8px rgba(255,93,177,0.4);">${label}</a>`;
}

export async function sendSignupEmail({ to, name, signupUrl }, logger) {
  const first = (name || "").split(/\s+/)[0] || "there";
  const subject = "Welcome to Curvy Cooking · set up your account 🌶️";
  const html = shell(`
    <tr><td style="padding:0 32px 8px;">
      <h1 style="margin:8px 0 16px;font-size:28px;line-height:1.2;letter-spacing:-0.02em;color:${INK};">Hey ${first},</h1>
      <p style="margin:0 0 16px;color:${INK_DIM};font-size:16px;line-height:1.6;">
        Thanks for grabbing the cookbook! Click below to set up your account and start cooking.
      </p>
    </td></tr>
    <tr><td style="padding:16px 32px 24px;" align="center">${btn(signupUrl, "Set up my account")}</td></tr>
    <tr><td style="padding:0 32px 24px;color:${INK_DIM};font-size:13px;line-height:1.6;">
      This link expires in 14 days. If the button doesn't work, copy and paste:<br>
      <span style="color:${INK};word-break:break-all;">${signupUrl}</span>
    </td></tr>
  `);
  const text = `Hey ${first},

Thanks for grabbing Curvy Cookbook! Click the link below to set up your account and start cooking:

${signupUrl}

This link expires in 14 days. Reply to this email if anything's off.

Ashley`;
  return sendEmail({ to, subject, html, text }, logger);
}

export async function sendResetEmail({ to, resetUrl }, logger) {
  const subject = "Reset your Curvy Cooking password";
  const html = shell(`
    <tr><td style="padding:0 32px 8px;">
      <h1 style="margin:8px 0 16px;font-size:28px;line-height:1.2;letter-spacing:-0.02em;color:${INK};">Reset your password</h1>
      <p style="margin:0 0 16px;color:${INK_DIM};font-size:16px;line-height:1.6;">
        Someone (hopefully you) asked to reset your Curvy Cooking password. Click below within the next hour to pick a new one.
      </p>
    </td></tr>
    <tr><td style="padding:16px 32px 24px;" align="center">${btn(resetUrl, "Choose a new password")}</td></tr>
    <tr><td style="padding:0 32px 24px;color:${INK_DIM};font-size:13px;line-height:1.6;">
      Didn't request this? You can ignore this email. Your password won't change.<br><br>
      If the button doesn't work, copy and paste:<br>
      <span style="color:${INK};word-break:break-all;">${resetUrl}</span>
    </td></tr>
  `);
  const text = `Reset your Curvy Cooking password.

Someone (hopefully you) asked to reset your password. Click below within the next hour:

${resetUrl}

If you didn't request this, ignore this email. Your password won't change.

Curvy Cooking`;
  return sendEmail({ to, subject, html, text }, logger);
}
