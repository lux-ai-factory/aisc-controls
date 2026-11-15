-- An answer names the revision of the AI card it was given under, beside the card version: answers given
-- before and after a correction of the same version are told apart. Empty for an answer stamped before
-- this column existed, and for an unstamped one. Safe on an existing install: one empty column.
ALTER TABLE controls.submission_answer ADD COLUMN IF NOT EXISTS system_card_revision integer
  CHECK (system_card_revision IS NULL OR system_card_revision > 0);
