CREATE INDEX `buckets_user_id_idx` ON `buckets` (`user_id`);--> statement-breakpoint
CREATE INDEX `file_access_tokens_file_id_id_idx` ON `file_access_tokens` (`file_id`,`id`);--> statement-breakpoint
CREATE INDEX `files_user_id_id_idx` ON `files` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tar_files_file_id_path_idx` ON `tar_files` (`file_id`,`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `targz_files_file_id_path_idx` ON `targz_files` (`file_id`,`path`);--> statement-breakpoint
CREATE INDEX `tokens_user_id_id_idx` ON `tokens` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `tokens_user_id_is_revoked_idx` ON `tokens` (`user_id`,`is_revoked`);