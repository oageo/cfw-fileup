ALTER TABLE `users` ADD `is_moderator` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_single_admin_idx` ON `users` (`is_admin`) WHERE "users"."is_admin" = 1;