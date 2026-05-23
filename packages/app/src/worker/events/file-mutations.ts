import { EventEmitter } from 'eventemitter3';

export type FileReference = {
	id: string;
	path: string;
	entryPaths?: string[];
};

export type BucketReference = {
	id: string;
	name: string;
};

export type MutationContext = {
	env: Env;
	origin: string;
	waitUntil?: (promise: Promise<void>) => void;
};

type MutationEvents = {
	'file:deleted': [MutationContext & { bucket: BucketReference; files: FileReference[] }];
	'file:moved': [MutationContext & { sourceBucket: BucketReference; targetBucket: BucketReference; files: Array<FileReference & { nextPath: string }> }];
	'file:updated': [MutationContext & { bucket: BucketReference; files: FileReference[] }];
	'directory:deleted': [MutationContext & { bucket: BucketReference; prefix: string; files: FileReference[] }];
	'directory:moved': [MutationContext & { sourceBucket: BucketReference; targetBucket: BucketReference; sourcePrefix: string; targetPrefix: string; files: Array<FileReference & { nextPath: string }> }];
	'bucket:deleted': [MutationContext & { bucket: BucketReference; files: FileReference[] }];
	'resolve-cache:purge-all': [MutationContext];
};

export const fileMutationEvents = new EventEmitter<MutationEvents>();

export function runMutationTask(waitUntil: MutationContext['waitUntil'], promise: Promise<void>, errorMessage: string): void {
	try {
		waitUntil?.(promise);
	} catch {
		void promise.catch((error: unknown) => console.error(errorMessage, error));
		return;
	}

	if (waitUntil === undefined) {
		void promise.catch((error: unknown) => console.error(errorMessage, error));
	}
}
