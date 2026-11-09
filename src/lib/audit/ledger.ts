import { db } from '../db';
import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';

function toAuditJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;

  const serialized = JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item
  );

  if (serialized === undefined) return Prisma.JsonNull;
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

export async function logAudit(
  userId: string,
  action: string,
  resourceId: string,
  oldState: unknown,
  newState: unknown,
  tx: Prisma.TransactionClient = db
) {
  const headerStore = await headers();
  const forwardedFor = headerStore.get('x-forwarded-for');
  const ipAddress =
    forwardedFor?.split(',')[0]?.trim() ||
    headerStore.get('x-real-ip')?.trim() ||
    null;

  await tx.auditLedger.create({
    data: {
      userId,
      action,
      resourceId,
      ipAddress,
      // Keep JSON as structured values so the ledger UI can display old/new state.
      oldState: toAuditJson(oldState),
      newState: toAuditJson(newState),
    }
  });
}
