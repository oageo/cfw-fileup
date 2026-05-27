import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

// バケット名の再利用防止テーブル（lowercaseで保存）
// 削除されたバケットの名前も再登録できないようにする
export const usedBucketNames = sqliteTable('used_bucket_names', {
	bucketName: text('bucket_name').primaryKey(),
});
