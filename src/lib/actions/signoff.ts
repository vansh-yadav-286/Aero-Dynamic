'use server';

import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { transitionFlight } from "@/lib/flight-lifecycle";
import { FlightStatus } from "@prisma/client";
import { DispatchApprovalSchema } from "@/lib/validations";

export async function signoffDeparture(flightId: string) {
  const session = await requireRole(['FLIGHT_DISPATCHER', 'OPERATIONS_DIRECTOR']);
  const parsed = DispatchApprovalSchema.parse({ flightId });

  await db.$transaction(async (tx) => {
    const plan = await tx.dispatchPlans.upsert({
      where: { flightId: parsed.flightId },
      create: { flightId: parsed.flightId },
      update: {},
    });

    // One approval belongs to each dispatch plan. Update it instead of
    // attempting a second insert against the unique planId constraint.
    await tx.dispatchApprovals.upsert({
      where: { planId: plan.id },
      create: { planId: plan.id, dispatcherId: session.user.id },
      update: { dispatcherId: session.user.id },
    });

    await transitionFlight(parsed.flightId, FlightStatus.DEPARTED, session.user.id, { tx });
  });
}

export async function signoffDepartureFormAction(formData: FormData) {
  const flightId = formData.get('flightId');
  if (typeof flightId === 'string' && flightId) {
    await signoffDeparture(flightId);
  }
}
