import { and, eq, ne, sql } from 'drizzle-orm';
import { appSettings, users, usedBucketNames } from '../scheme/index';
import { DEFAULT_FORBIDDEN_USERNAMES, DEFAULT_FORBIDDEN_BUCKET_NAMES } from '../../shared/app-settings';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export async function getForbiddenNames(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: DrizzleD1Database<any>,
	settingKey: string,
	defaultValue: string,
): Promise<Set<string>> {
	const setting = await db
		.select()
		.from(appSettings)
		.where(eq(appSettings.key, settingKey))
		.get();

	const value = setting?.value ?? defaultValue;
	return new Set(
		value
			.split(',')
			.map((name) => name.trim().toLowerCase())
			.filter((name) => name.length > 0),
	);
}

/** フォーマット検証はリクエストスキーマ側で実施済み。禁止名・重複チェックのみ行う。 */
export async function validateUsername(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: DrizzleD1Database<any>,
	username: string,
	excludeUserId?: string,
): Promise<string | null> {
	const usernameLower = username.toLowerCase();

	const forbidden = await getForbiddenNames(db, 'forbidden_usernames', DEFAULT_FORBIDDEN_USERNAMES);
	if (forbidden.has(usernameLower)) {
		return 'This username is not allowed';
	}

	const usedEntry = await db
		.select({ id: users.id })
		.from(users)
		.where(and(
			sql`lower(${users.username}) = ${usernameLower}`,
			excludeUserId ? ne(users.id, excludeUserId) : undefined,
		))
		.get();
	if (usedEntry) {
		return 'Username already exists';
	}

	return null;
}

/** フォーマット検証はリクエストスキーマ側で実施済み。禁止名・重複チェックのみ行う。 */
export async function validateBucketName(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: DrizzleD1Database<any>,
	bucketName: string,
): Promise<string | null> {
	const bucketNameLower = bucketName.toLowerCase();

	const forbidden = await getForbiddenNames(db, 'forbidden_bucket_names', DEFAULT_FORBIDDEN_BUCKET_NAMES);
	if (forbidden.has(bucketNameLower)) {
		return 'This bucket name is not allowed';
	}

	const usedEntry = await db
		.select()
		.from(usedBucketNames)
		.where(eq(usedBucketNames.bucketName, bucketNameLower))
		.get();
	if (usedEntry) {
		return 'Bucket name already exists';
	}

	return null;
}

/** ディレクトリ名にバケット名と同じ禁止ワードを適用する。 */
export async function validateDirectoryPathForbiddenNames(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: DrizzleD1Database<any>,
	path: string,
): Promise<string | null> {
	const forbidden = await getForbiddenNames(db, 'forbidden_bucket_names', DEFAULT_FORBIDDEN_BUCKET_NAMES);
	const segments = path.replace(/\/$/, '').split('/');
	for (const segment of segments) {
		if (forbidden.has(segment.toLowerCase())) return 'This directory name is not allowed';
	}
	return null;
}
