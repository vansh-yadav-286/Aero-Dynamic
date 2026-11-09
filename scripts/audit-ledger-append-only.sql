-- Run once after the Prisma schema has created the "AuditLedger" table.
-- This blocks UPDATE, DELETE and TRUNCATE from application SQL paths.
-- Database owners can still alter triggers, so restrict production DB privileges.

CREATE OR REPLACE FUNCTION reject_audit_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLedger is append-only; % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_ledger_no_mutation ON "AuditLedger";

CREATE TRIGGER audit_ledger_no_mutation
BEFORE UPDATE OR DELETE OR TRUNCATE ON "AuditLedger"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_audit_ledger_mutation();
