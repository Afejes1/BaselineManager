-- User-curated AI work products are deliberately separate from source evidence,
-- Government assessments, and adjudicated decisions.  They are a repeatable
-- analyst scratchpad until a steward records and supports a governed action.
CREATE TABLE IF NOT EXISTS assistant_saved_prompt (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  scope_kind TEXT CHECK (scope_kind IN ('initiative','change_request','product','platform')),
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(program_id, scope_kind, title)
);

CREATE INDEX IF NOT EXISTS idx_assistant_saved_prompt_scope
  ON assistant_saved_prompt(program_id, scope_kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_scratchpad_entry (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  context_kind TEXT NOT NULL CHECK (context_kind IN ('initiative','change_request','product','platform')),
  context_id TEXT NOT NULL,
  context_label TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  proposal_json TEXT,
  model_name TEXT,
  grounding_summary TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_scratchpad_context
  ON assistant_scratchpad_entry(program_id, context_kind, context_id, updated_at DESC);
