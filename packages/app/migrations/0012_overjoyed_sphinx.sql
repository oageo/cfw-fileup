-- https://github.com/tamaina/cfw-fileup/pull/TBD
ALTER TABLE `files` ADD `download_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `is_download_count_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `is_download_count_visible` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `global_quotas` ADD `can_use_download_count` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `can_use_download_count` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_quotas` ADD `can_use_download_count` integer DEFAULT false NOT NULL;
