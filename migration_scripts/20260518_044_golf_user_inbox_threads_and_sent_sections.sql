ALTER TABLE inbox_messages ADD COLUMN thread_id VARCHAR(191) NULL AFTER id;
ALTER TABLE inbox_messages ADD COLUMN parent_message_id VARCHAR(191) NULL AFTER thread_id;

UPDATE inbox_messages
   SET thread_id = id
 WHERE thread_id IS NULL OR thread_id = '';

ALTER TABLE inbox_messages MODIFY thread_id VARCHAR(191) NOT NULL;

CREATE INDEX idx_inbox_messages_thread_created ON inbox_messages(thread_id, created_at);
CREATE INDEX idx_inbox_messages_parent ON inbox_messages(parent_message_id);
CREATE INDEX idx_inbox_messages_sender_type_created ON inbox_messages(sender_user_id, message_type, created_at);
