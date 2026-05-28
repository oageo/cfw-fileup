import { DEFAULT_APP_NAME } from '../../shared/app-settings';
import { getAppSettingCached } from './app-settings-cache';

export async function getAppName(env: Env): Promise<string> {
	const appName = await getAppSettingCached(env, 'app_name');
	return appName?.trim() || DEFAULT_APP_NAME;
}
