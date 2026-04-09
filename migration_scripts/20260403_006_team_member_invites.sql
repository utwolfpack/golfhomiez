CREATE TABLE IF NOT EXISTS invitations (
  id VARCHAR(191) PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  invited_by_user_id VARCHAR(191) NULL,
  invited_by_email VARCHAR(191) NOT NULL,
  team_id VARCHAR(191) NULL,
  purpose VARCHAR(64) NOT NULL DEFAULT 'registration_invite',
  custom_message TEXT NULL,
  invite_url TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invitations_email (email),
  INDEX idx_invitations_team_id (team_id)
);
