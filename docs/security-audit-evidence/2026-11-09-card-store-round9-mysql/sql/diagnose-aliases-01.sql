SELECT CURRENT_USER() AS current_user;
SELECT CURRENT_USER() AS `current_user`;
SELECT CURRENT_ROLE() AS current_role;
SELECT CURRENT_ROLE() AS `current_role`;
SELECT @@server_uuid AS server_uuid, @@version AS version, CURRENT_USER() AS `current_user`, DATABASE() AS db, @@partial_revokes AS partial_revokes, CURRENT_ROLE() AS `current_role`;
SHOW GRANTS;
