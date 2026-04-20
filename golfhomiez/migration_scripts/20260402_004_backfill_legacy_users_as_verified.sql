UPDATE `user`
SET emailVerified = TRUE,
    updatedAt = CURRENT_TIMESTAMP
WHERE COALESCE(emailVerified, FALSE) = FALSE;
