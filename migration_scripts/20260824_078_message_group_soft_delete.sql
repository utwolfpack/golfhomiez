-- Soft-delete notification message groups while retaining their existing inbox messages.
ALTER TABLE message_groups
  ADD COLUMN deleted_at DATETIME(6) NULL AFTER updated_at;

CREATE INDEX idx_message_groups_deleted_at
  ON message_groups (deleted_at);
