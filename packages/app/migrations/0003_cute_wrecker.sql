-- https://github.com/tamaina/cfw-fileup/pull/105
CREATE TABLE `misskey_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`misskey_id` text NOT NULL,
	`issuer` text NOT NULL,
	`username` text,
	`name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `misskey_accounts_misskey_id_unique` ON `misskey_accounts` (`misskey_id`);--> statement-breakpoint
INSERT INTO `misskey_accounts` (`id`, `user_id`, `misskey_id`, `issuer`, `username`, `name`, `created_at`)
SELECT
	`id` || ':misskey',
	`id`,
	`misskey_id`,
	CASE
		WHEN `misskey_id` LIKE 'https://%/%' THEN 'https://' || substr(substr(`misskey_id`, 9), 1, instr(substr(`misskey_id`, 9), '/') - 1)
		WHEN `misskey_id` LIKE 'http://%/%' THEN 'http://' || substr(substr(`misskey_id`, 8), 1, instr(substr(`misskey_id`, 8), '/') - 1)
		ELSE `misskey_id`
	END,
	NULL,
	NULL,
	CAST(strftime('%s', 'now') AS integer) * 1000
FROM `users`
WHERE `misskey_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_states` ADD `link_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `tokens` ADD `reauthenticated_at` integer;
