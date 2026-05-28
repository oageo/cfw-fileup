import { EmailMessage } from 'cloudflare:email';
import { and, eq } from 'drizzle-orm';
import { genEaidx } from '../../shared/eaid-x';
import { emailNotificationEvents, emailVerificationTokens, users } from '../scheme/index';
import { generateToken, tokenToDigest } from './crypto';
import { getDb } from './db';
import { getAppName } from './app-name';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const DNS_OVER_HTTPS_URL = 'https://cloudflare-dns.com/dns-query';

type NotificationType = typeof emailNotificationEvents.$inferSelect.type;
export type EmailSendPreflightFailure = 'email_not_configured' | 'public_app_url_not_configured' | 'recipient_domain_has_no_mx';

type DnsJsonResponse = {
	Status?: number;
	Answer?: Array<{
		type?: number;
		data?: string;
	}>;
};

export function getPublicAppUrl(env: Env, requestUrl?: string): string {
	const configured = typeof env.PUBLIC_APP_URL === 'string' ? env.PUBLIC_APP_URL.trim() : '';
	if (configured) return configured.replace(/\/+$/, '');
	if (requestUrl) {
		const url = new URL(requestUrl);
		return url.origin;
	}
	return '';
}

function getConfiguredPublicAppUrl(env: Env): string | null {
	const appUrl = getPublicAppUrl(env);
	return appUrl === '' ? null : appUrl;
}

function getMailFrom(env: Env): string | null {
	const from = typeof env.MAIL_FROM === 'string' ? env.MAIL_FROM.trim() : '';
	return from || null;
}

function hasMailer(env: Env): env is Env & { MAILER: SendEmail } {
	return typeof (env as { MAILER?: unknown }).MAILER === 'object' && (env as { MAILER?: { send?: unknown } }).MAILER?.send instanceof Function;
}

function buildRawEmail(from: string, to: string, subject: string, text: string): string {
	const headers = [
		`From: ${from}`,
		`To: ${to}`,
		`Subject: ${subject}`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: 8bit',
	];
	return `${headers.join('\r\n')}\r\n\r\n${text}`;
}

async function appendEmailFooter(env: Env, text: string): Promise<string> {
	const appName = await getAppName(env);
	const appUrl = getConfiguredPublicAppUrl(env);
	return [
		text.trimEnd(),
		'',
		'-- ',
		appName,
		appUrl ?? '',
	].join('\n');
}

function isMxCheckDisabled(env: Env): boolean {
	return (env as { MAIL_MX_CHECK_DISABLED?: string }).MAIL_MX_CHECK_DISABLED === 'true';
}

function getEmailDomain(email: string): string | null {
	const at = email.lastIndexOf('@');
	if (at <= 0 || at === email.length - 1) return null;
	const domain = email.slice(at + 1).trim().replace(/\.$/, '').toLowerCase();
	return domain.includes('.') ? domain : null;
}

export async function hasMxRecord(email: string): Promise<boolean> {
	const domain = getEmailDomain(email);
	if (domain === null) return false;
	let res: Response;
	try {
		const url = new URL(DNS_OVER_HTTPS_URL);
		url.searchParams.set('name', domain);
		url.searchParams.set('type', 'MX');
		res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
	} catch (e) {
		console.warn('Failed to check MX record:', e);
		return false;
	}
	if (!res.ok) return false;
	let data: DnsJsonResponse;
	try {
		data = await res.json() as DnsJsonResponse;
	} catch {
		return false;
	}
	if (data.Status !== 0) return false;
	return (data.Answer ?? []).some((answer) => {
		if (answer.type !== 15 || typeof answer.data !== 'string') return false;
		const data = answer.data.trim().replace(/\s+/g, ' ').toLowerCase();
		if (data === '' || data === '.' || data === '0 .') return false;
		return true;
	});
}

export async function getEmailSendPreflightFailure(env: Env, to: string): Promise<EmailSendPreflightFailure | null> {
	if (!getMailFrom(env) || !hasMailer(env)) return 'email_not_configured';
	if (!getConfiguredPublicAppUrl(env)) return 'public_app_url_not_configured';
	if (!isMxCheckDisabled(env) && !await hasMxRecord(to)) return 'recipient_domain_has_no_mx';
	return null;
}

export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
	const from = getMailFrom(env);
	const preflightFailure = await getEmailSendPreflightFailure(env, to);
	if (preflightFailure !== null) {
		if (preflightFailure === 'email_not_configured') {
			console.warn('Email is not configured; skipped sending email', { to, subject });
		} else if (preflightFailure === 'public_app_url_not_configured') {
			console.warn('PUBLIC_APP_URL is not configured; skipped sending email', { to, subject });
		} else {
			console.warn('Recipient domain has no MX record; skipped sending email', { to, subject });
		}
		return;
	}
	if (!from || !hasMailer(env)) {
		console.warn('Email is not configured; skipped sending email', { to, subject });
		return;
	}
	const raw = buildRawEmail(from, to, subject, await appendEmailFooter(env, text));
	const message = new EmailMessage(from, to, raw);
	try {
		Object.assign(message, { raw });
	} catch {
		// Some runtimes may keep EmailMessage immutable; the raw copy is only for tests.
	}
	await env.MAILER.send(message);
}

export async function sendEmailLines(env: Env, to: string, subject: string, lines: readonly string[]): Promise<void> {
	await sendEmail(env, to, subject, lines.join('\n'));
}

export async function sendAccountEmail(env: Env, userId: string, subject: string, text: string): Promise<void> {
	const user = await getDb(env)
		.select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
		.from(users)
		.where(eq(users.id, userId))
		.get();
	if (!user?.email || user.emailVerifiedAt === null) return;
	await sendEmail(env, user.email, subject, text);
}

export async function sendAccountEmailLines(env: Env, userId: string, subject: string, lines: readonly string[]): Promise<void> {
	await sendAccountEmail(env, userId, subject, lines.join('\n'));
}

export async function reserveEmailNotification(env: Env, userId: string, type: NotificationType, eventKey: string, now = Date.now()): Promise<boolean> {
	try {
		await getDb(env).insert(emailNotificationEvents).values({
			id: genEaidx(now),
			userId,
			type,
			eventKey,
			createdAt: now,
		});
		return true;
	} catch (e) {
		if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) return false;
		throw e;
	}
}

export async function createEmailVerification(env: Env, userId: string, email: string, requestUrl?: string, now = Date.now()): Promise<{ token: string; verifyUrl: string }> {
	const tokenValue = generateToken();
	const token = await tokenToDigest(tokenValue);
	if (token === null) throw new Error('Failed to digest email verification token');
	const db = getDb(env);
	await db.delete(emailVerificationTokens).where(and(eq(emailVerificationTokens.userId, userId), eq(emailVerificationTokens.email, email)));
	await db.insert(emailVerificationTokens).values({
		id: genEaidx(now),
		userId,
		email,
		token,
		expiresAt: now + EMAIL_VERIFICATION_TTL_MS,
		createdAt: now,
		usedAt: null,
	});

	const appUrl = getPublicAppUrl(env, requestUrl);
	const verifyUrl = appUrl
		? `${appUrl}/my/account?email_verification_token=${encodeURIComponent(tokenValue)}`
		: `メール確認トークン: ${tokenValue}`;
	return { token: tokenValue, verifyUrl };
}

export async function verifyAccountEmail(env: Env, tokenValue: string, now = Date.now()): Promise<{ email: string; emailVerifiedAt: number }> {
	const token = await tokenToDigest(tokenValue);
	if (token === null) throw new Error('Failed to digest email verification token');
	const db = getDb(env);
	const record = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.token, token)).get();
	if (!record || record.usedAt !== null || record.expiresAt <= now) {
		throw new Error('EMAIL_VERIFICATION_TOKEN_INVALID');
	}
	const user = await db.select({ email: users.email }).from(users).where(eq(users.id, record.userId)).get();
	if (!user || user.email !== record.email) throw new Error('EMAIL_VERIFICATION_TOKEN_INVALID');
	await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, record.userId));
	await db.update(emailVerificationTokens).set({ usedAt: now }).where(eq(emailVerificationTokens.id, record.id));
	return { email: record.email, emailVerifiedAt: now };
}
