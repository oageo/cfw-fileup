-- https://github.com/tamaina/cfw-fileup/issues/68
ALTER TABLE `directories` ADD `is_listed` integer DEFAULT true NOT NULL;
