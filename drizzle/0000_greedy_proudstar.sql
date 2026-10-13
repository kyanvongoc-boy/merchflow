CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_owner_at` ON `audit` (`owner`,`at`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `records_owner_kind` ON `records` (`owner`,`kind`);