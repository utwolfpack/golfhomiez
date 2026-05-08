-- Runtime organizer session queries now use explicit COLLATE clauses, so this
-- migration is intentionally non-destructive. It records the deployment without
-- modifying foreign-keyed organizer account/session columns.
SELECT 1;
