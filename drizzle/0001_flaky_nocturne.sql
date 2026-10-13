CREATE TABLE `google_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`browser_hash` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL,
	`target_email` text NOT NULL,
	`mode` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `google_states_expiry` ON `google_oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `google_mail_tokens` (
	`mailbox_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`email` text NOT NULL,
	`encrypted_tokens` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `google_tokens_owner` ON `google_mail_tokens` (`owner`);