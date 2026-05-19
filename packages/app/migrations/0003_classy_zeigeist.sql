ALTER TABLE `files` ADD `access_key` text;--> statement-breakpoint
UPDATE `files` SET `access_key` = `id` WHERE `access_key` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `files_access_key_idx` ON `files` (`access_key`);
