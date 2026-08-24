-- Lockheed ROM values may be effort points rather than labor hours.  Keep
-- source points immutable and record the Government planning conversion on
-- each Initiative so its calculations are explicit and independently auditable.
ALTER TABLE `initiative` ADD COLUMN `rom_hours_per_point` real NOT NULL DEFAULT 500;
--> statement-breakpoint
ALTER TABLE `initiative` ADD COLUMN `rom_conversion_rationale` text;
--> statement-breakpoint
PRAGMA optimize;
