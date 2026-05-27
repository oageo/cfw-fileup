export function runBackgroundTask(
	waitUntil: ((promise: Promise<void>) => void) | undefined,
	promise: Promise<void>,
	errorMessage: string,
): void {
	const handledPromise = promise.catch((error: unknown) => {
		console.error(errorMessage, error);
	});

	try {
		waitUntil?.(handledPromise);
	} catch {
		void handledPromise;
	}
}
