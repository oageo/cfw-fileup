export interface ShareTargetFileEntry {
	readonly file: File;
	readonly name: string;
	readonly type: string;
	readonly lastModified: number;
}

export interface ShareTargetPayload {
	readonly id: string;
	readonly createdAt: number;
	readonly files: readonly ShareTargetFileEntry[];
}

const DB_NAME = 'cfw-fileup-share-target';
const DB_VERSION = 1;
const STORE_NAME = 'payloads';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Failed to open share target database'));
	});
}

async function withStore<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, mode);
			const request = callback(tx.objectStore(STORE_NAME));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error('Share target database request failed'));
			tx.onerror = () => reject(tx.error ?? new Error('Share target database transaction failed'));
		});
	} finally {
		db.close();
	}
}

export async function putShareTargetPayload(payload: ShareTargetPayload): Promise<void> {
	await withStore('readwrite', store => store.put(payload));
}

export async function takeShareTargetPayload(id: string): Promise<ShareTargetPayload | null> {
	const payload = await withStore<ShareTargetPayload | undefined>('readonly', store => store.get(id));
	if (!payload) return null;
	await withStore('readwrite', store => store.delete(id));
	return payload;
}
