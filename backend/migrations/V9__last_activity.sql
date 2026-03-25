ALTER TABLE groups ADD COLUMN last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE groups SET last_activity_at = COALESCE(
    (SELECT MAX(created_at) FROM expenses WHERE group_id = groups.id),
    groups.created_at
);
