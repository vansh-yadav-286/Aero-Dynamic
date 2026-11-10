'use server';

import { db } from "../db";
import { requireRole } from "../auth";
import { logAudit } from "../audit/ledger";
import { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function updateUserRole(
  targetUserId: string,
  newRole: Role,
  confirmSelfDemotion: boolean = false
) {
  const session = await requireRole([Role.OPERATIONS_DIRECTOR]);
  const callerId = session.user.id;

  const targetUser = await db.users.findUnique({ where: { id: targetUserId } });
  if (!targetUser) throw new Error("Target user not found.");

  const oldRole = targetUser.role;
  if (oldRole === newRole) return { success: true };

  if (targetUserId === callerId && oldRole === Role.OPERATIONS_DIRECTOR && newRole !== Role.OPERATIONS_DIRECTOR) {
    if (!confirmSelfDemotion) {
      return {
        success: false,
        error: "self_demotion_confirmation_required",
        message: "You are attempting to demote your own account. This requires confirmation."
      };
    }

    const directorsCount = await db.users.count({ where: { role: Role.OPERATIONS_DIRECTOR } });
    if (directorsCount <= 1) {
      throw new Error("Action blocked: You are the last remaining Operations Director in the system. You cannot demote yourself.");
    }
  }

  const updatedUser = await db.$transaction(async (tx) => {
    const user = await tx.users.update({
      where: { id: targetUserId },
      data: { role: newRole },
    });

    await logAudit(callerId, "UPDATE_USER_ROLE", targetUserId, { role: oldRole }, { role: newRole }, tx);
    return user;
  });

  revalidatePath("/director/admin");
  revalidatePath("/director/ledger");
  return { success: true, user: updatedUser };
}

export async function updateSystemConfig(key: string, value: string) {
  const session = await requireRole([Role.OPERATIONS_DIRECTOR]);
  const callerId = session.user.id;

  if (key === "RISK_THRESHOLD") {
    const threshold = Number(value);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 10) {
      throw new Error("Risk threshold must be between 0 and 10.");
    }
  }

  const existingConfig = await db.systemConfig.findUnique({ where: { key } });
  const oldValue = existingConfig ? existingConfig.value : null;
  if (oldValue === value) return { success: true };

  await db.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

    await logAudit(callerId, "UPDATE_SYSTEM_CONFIG", key, { value: oldValue }, { value }, tx);
  });

  revalidatePath("/director/admin");
  revalidatePath("/director/ledger");
  revalidatePath("/dispatcher/dashboard");
  revalidatePath("/dispatcher/flight/[id]");
  return { success: true };
}
