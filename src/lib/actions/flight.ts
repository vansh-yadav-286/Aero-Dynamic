'use server';

import { db } from '../db';
import { requireRole } from '../auth';
import { transitionFlight } from '../flight-lifecycle';
import { FlightStatus } from '@prisma/client';
import { eventBus } from '../events';
import { revalidatePath } from 'next/cache';
import { DispatchApprovalSchema, ManualOverrideSchema } from '../validations';

export async function approveDispatch(flightId: string) {
  const session = await requireRole(['FLIGHT_DISPATCHER', 'OPERATIONS_DIRECTOR']);
  const parsed = DispatchApprovalSchema.parse({ flightId });

  const result = await db.$transaction(async (tx) => {
    await transitionFlight(parsed.flightId, FlightStatus.READY, session.user.id, { tx });

    const plan = await tx.dispatchPlans.upsert({
      where: { flightId: parsed.flightId },
      create: { flightId: parsed.flightId },
      update: {},
    });

    return tx.dispatchApprovals.upsert({
      where: { planId: plan.id },
      create: { planId: plan.id, dispatcherId: session.user.id },
      update: { dispatcherId: session.user.id },
    });
  });

  eventBus.emit('dispatch_update', {
    type: 'DISPATCH_APPROVED',
    flightId: parsed.flightId,
    timestamp: new Date().toISOString(),
  });

  revalidatePath(`/dispatcher/flight/${parsed.flightId}`);
  revalidatePath('/dispatcher/dashboard');
  return result;
}

export async function overrideDispatch(flightId: string, justification: string) {
  const session = await requireRole(['OPERATIONS_DIRECTOR']);
  const parsed = ManualOverrideSchema.parse({
    flightId,
    justification: justification.trim(),
  });

  const result = await db.$transaction(async (tx) => {
    await transitionFlight(parsed.flightId, FlightStatus.READY, session.user.id, {
      isOverride: true,
      tx,
    });

    const override = await tx.manualOverrides.create({
      data: {
        flightId: parsed.flightId,
        userId: session.user.id,
        justification: parsed.justification,
      }
    });

    const plan = await tx.dispatchPlans.upsert({
      where: { flightId: parsed.flightId },
      create: { flightId: parsed.flightId },
      update: {},
    });

    await tx.dispatchApprovals.upsert({
      where: { planId: plan.id },
      create: { planId: plan.id, dispatcherId: session.user.id },
      update: { dispatcherId: session.user.id },
    });

    return override;
  });

  eventBus.emit('dispatch_update', {
    type: 'MANUAL_OVERRIDE',
    flightId: parsed.flightId,
    justification: parsed.justification,
    timestamp: new Date().toISOString(),
  });

  revalidatePath(`/dispatcher/flight/${parsed.flightId}`);
  revalidatePath('/dispatcher/dashboard');
  return result;
}

export async function approveDispatchFormAction(formData: FormData) {
  const flightId = formData.get('flightId');
  if (typeof flightId === 'string' && flightId) {
    await approveDispatch(flightId);
  }
}

export async function overrideDispatchFormAction(formData: FormData) {
  const flightId = formData.get('flightId');
  const justification = formData.get('justification');

  if (typeof flightId === 'string' && typeof justification === 'string') {
    await overrideDispatch(flightId, justification);
  }
}
