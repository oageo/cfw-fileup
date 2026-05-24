-- https://github.com/tamaina/cfw-fileup/pull/TBD
CREATE TABLE `moderation_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text,
	`action` text NOT NULL,
	`target_file_id` text,
	`target_user_id` text,
	`data` text,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moderation_audit_logs_admin_user_id_id_idx` ON `moderation_audit_logs` (`admin_user_id`,`id`);--> statement-breakpoint
CREATE INDEX `moderation_audit_logs_target_file_id_id_idx` ON `moderation_audit_logs` (`target_file_id`,`id`);--> statement-breakpoint
CREATE INDEX `moderation_audit_logs_target_user_id_id_idx` ON `moderation_audit_logs` (`target_user_id`,`id`);--> statement-breakpoint
ALTER TABLE `files` ADD `is_moderation_forced_private` integer DEFAULT false NOT NULL;
