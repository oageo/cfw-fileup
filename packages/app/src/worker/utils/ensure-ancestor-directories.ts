import { directories } from '../scheme/index';
import { genEaidx } from '../../shared/eaid-x';
import type { getDb } from './db';

type Db = ReturnType<typeof getDb>;

export async function ensureAncestorDirectories(db: Db, bucketId: string, filePath: string): Promise<void> {
	const segments = filePath.split('/');
	const ancestorCount = segments.length - 1;
	if (ancestorCount === 0) return;

	for (let i = 1; i <= ancestorCount; i++) {
		const dirPath = segments.slice(0, i).join('/') + '/';
		await db.insert(directories).values({
			id: genEaidx(Date.now()),
			bucketId,
			path: dirPath,
			isListed: true,
		}).onConflictDoNothing();
	}
}
