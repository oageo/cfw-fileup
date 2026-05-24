-- https://github.com/tamaina/cfw-fileup/pull/514
ALTER TABLE `users` ADD `effective_max_buckets` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `effective_max_bucket_size_bytes` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `effective_max_files_per_bucket` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `effective_max_daily_uploads` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `effective_can_use_download_count` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `effective_quota_expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `effective_quota_updated_at` integer;
