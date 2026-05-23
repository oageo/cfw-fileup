CREATE TABLE `ip_bans` (
	`id` text PRIMARY KEY NOT NULL,
	`cidr` text NOT NULL,
	`reason` text,
	`source_event_id` text,
	`created_by` text,
	`expires_at` integer,
	FOREIGN KEY (`source_event_id`) REFERENCES `moderation_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ip_bans_cidr_unique` ON `ip_bans` (`cidr`);--> statement-breakpoint
CREATE TABLE `moderation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`user_token_id` text,
	`action` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`data` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moderation_events_user_token_id_id_idx` ON `moderation_events` (`user_token_id`,`id`);--> statement-breakpoint
ALTER TABLE `tokens` ADD `is_revoked` integer DEFAULT false NOT NULL;