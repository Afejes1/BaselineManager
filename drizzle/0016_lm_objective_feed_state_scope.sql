-- Compatibility repair for development databases that applied the initial
-- feed-history migration before the state key was scoped through its subject.
-- Feed keys (for example "9") are only unique within a program/source feed.
DROP INDEX IF EXISTS `lm_objective_feed_state_key_uq`;
