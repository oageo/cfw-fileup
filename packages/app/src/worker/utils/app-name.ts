import { eq } from 'drizzle-orm';
import { DEFAULT_APP_NAME } from '../../shared/app-settings';
import { appSettings } from '../scheme/index';
import { getDb } from './db';

export async function getAppName(env: Env): Promise<string> {
	const setting = await getDb(env)
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, 'app_name'))
		.get();
	return setting?.value?.trim() || DEFAULT_APP_NAME;
}
