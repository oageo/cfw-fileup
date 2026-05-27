-- https://github.com/tamaina/cfw-fileup/issues/120
ALTER TABLE `crypto_payment_orders` ADD `cf_region_snapshot` text DEFAULT '{}' NOT NULL;
