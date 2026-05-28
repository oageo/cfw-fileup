import type { Context } from 'hono';

export type WaitUntil = (promise: Promise<void>) => void;

export function runBackgroundTask(
	waitUntil: WaitUntil | undefined,
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

export function getContextWaitUntil(c: Context<{ Bindings: Env }>): WaitUntil | undefined {
	try {
		return c.executionCtx.waitUntil.bind(c.executionCtx);
	} catch {
		return undefined;
	}
}

export function runContextBackgroundTask(
	c: Context<{ Bindings: Env }>,
	promise: Promise<void>,
	errorMessage: string,
): void {
	runBackgroundTask(getContextWaitUntil(c), promise, errorMessage);
}
