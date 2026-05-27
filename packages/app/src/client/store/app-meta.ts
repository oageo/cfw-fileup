import { readonly, ref } from 'vue';

export const DEFAULT_APP_NAME = 'CFW FileUp';

const appNameState = ref(DEFAULT_APP_NAME);
let loadPromise: Promise<void> | null = null;

export const appName = readonly(appNameState);

export type AppMeta = {
	appName: string;
};

export function setAppName(value: string): void {
	appNameState.value = value.trim() || DEFAULT_APP_NAME;
	document.title = appNameState.value;
}

export async function loadAppMeta(): Promise<void> {
	loadPromise ??= (async () => {
		try {
			const res = await fetch('/api/meta');
			if (!res.ok) return;
			const meta = await res.json() as { appName?: unknown };
			if (typeof meta.appName === 'string' && meta.appName.trim() !== '') {
				setAppName(meta.appName);
			}
		} catch {
			// Keep the default app name when metadata is unavailable.
		} finally {
			document.title = appNameState.value;
		}
	})();
	await loadPromise;
}
