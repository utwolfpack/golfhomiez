ALTER TABLE team_members ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'invited' AFTER email;
ALTER TABLE team_members ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
UPDATE team_members tm
LEFT JOIN `user` u ON LOWER(u.email) = LOWER(tm.email)
   SET tm.status = CASE
         WHEN COALESCE(u.emailVerified, 0) <> 0 THEN 'active'
         WHEN u.id IS NOT NULL THEN 'pending_verification'
         ELSE 'invited'
       END,
       tm.verified = CASE WHEN COALESCE(u.emailVerified, 0) <> 0 THEN 1 ELSE 0 END;
