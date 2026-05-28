import { getRequestIp } from '../utils/request-ip';
import { getAppName } from '../utils/app-name';
import { sendAccountEmailLines } from '../utils/email';

export async function sendLoginNotification(env: Env, options: {
	userId: string;
	method: string;
	request: { header(name: string): string | undefined };
}): Promise<void> {
	const appName = await getAppName(env);
	const ip = getRequestIp(options.request) ?? 'unknown';
	const userAgent = options.request.header('User-Agent') ?? 'unknown';
	await sendAccountEmailLines(env, options.userId, `${appName} 新しいログイン`, [
		`${appName} に新しいログインがありました。`,
		'',
		`日時: ${new Date().toISOString()}`,
		`ログイン方式: ${options.method}`,
		`IPアドレス: ${ip}`,
		`User-Agent: ${userAgent}`,
		'',
		'心当たりがない場合は、アカウント設定からトークンを取り消してください。',
	]);
}
