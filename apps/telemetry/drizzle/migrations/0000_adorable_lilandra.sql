CREATE TABLE IF NOT EXISTS `daily_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`event_name` text NOT NULL,
	`event_count` integer DEFAULT 0,
	`unique_users` integer DEFAULT 0,
	`metrics` text DEFAULT '{}'
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_daily_stats_unique` ON `daily_stats` (`date`,`event_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_daily_stats_date` ON `daily_stats` (`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_name` text NOT NULL,
	`anonymous_id` text NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`received_at` text DEFAULT (datetime('now')) NOT NULL,
	`properties` text DEFAULT '{}' NOT NULL,
	`cli_version` text,
	`os_type` text,
	`is_ci` integer DEFAULT false
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_timestamp` ON `events` (`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_name` ON `events` (`event_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_version` ON `events` (`cli_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_anonymous_id` ON `events` (`anonymous_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_name_timestamp` ON `events` (`event_name`,`timestamp`);
