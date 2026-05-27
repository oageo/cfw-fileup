-- https://github.com/tamaina/cfw-fileup/issues/111
ALTER TABLE `users` ADD `effective_show_ads` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `effective_can_disable_file_ads` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `global_quotas` ADD `show_ads` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `global_quotas` ADD `can_disable_file_ads` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `show_ads` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `can_disable_file_ads` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_quotas` ADD `show_ads` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user_quotas` ADD `can_disable_file_ads` integer DEFAULT false NOT NULL;
