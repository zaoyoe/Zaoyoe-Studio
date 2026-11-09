-- Statement 1; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 2; parameters intentionally omitted
SELECT @@server_uuid AS server_uuid, @@version AS version, CURRENT_USER() AS current_user, DATABASE() AS db, @@partial_revokes AS partial_revokes, CURRENT_ROLE() AS current_role;

