CREATE TABLE share_links (
    code VARCHAR(16) PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    can_delete_group BOOLEAN NOT NULL DEFAULT false,
    can_manage_members BOOLEAN NOT NULL DEFAULT false,
    can_update_payment BOOLEAN NOT NULL DEFAULT true,
    can_add_expenses BOOLEAN NOT NULL DEFAULT true,
    can_edit_expenses BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_share_links_group_id ON share_links(group_id);
