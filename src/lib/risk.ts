import { db } from './db';
import { Prisma, Severity } from '@prisma/client';
import { getRiskThreshold } from './config';
import { eventBus } from './events';

const WEIGHTS = { w1: 0.3, w2: 0.4, w3: 0.3 };

// Every factor and the final score use the same 0–10 scale.
function severityToRiskFactor(severity: Severity): number {
  switch (severity) {
    case 'LOW': return 1;
    case 'MEDIUM': return 4;
    case 'HIGH': return 7;
    case 'CRITICAL': return 10;
    default: return 0;
  }
}

export async function calculateRisk(flightId: string, tx: Prisma.TransactionClient = db) {
  const flight = await tx.flights.findUnique({
    where: { id: flightId },
    include: {
      checklists: { include: { items: true } },
      weather: { orderBy: { id: 'desc' }, take: 1 },
      incidents: { where: { resolved: false } },
      crewUsers: { include: { shiftLogs: { orderBy: { startTime: 'desc' }, take: 1 } } }
    }
  });

  if (!flight) throw new Error('Flight not found');

  // 1. Fatigue (Fs): the stored fatigue index already uses a 0–10 scale.
  const crewUsers = flight.crewUsers || [];
  const shiftLogs = crewUsers.map((user: any) => user.shiftLogs?.[0]).filter(Boolean);
  const Fs = shiftLogs.length > 0
    ? Math.min(10, Math.max(0, shiftLogs.reduce((sum: number, log: any) => sum + log.fatigueIndex, 0) / shiftLogs.length))
    : 0;

  // 2. Weather (Wi): weather service stores a normalized 0–1 severity index.
  const weatherIndex = flight.weather[0]?.severityIndex ?? 0;
  const Wi = Math.min(10, Math.max(0, weatherIndex > 1 ? weatherIndex : weatherIndex * 10));

  // 3. Mechanical/checklist (Md): equipment severity and checklist penalty
  // are both represented on the same 0–10 scale.
  const incompleteMandatory = flight.checklists
    .flatMap(checklist => checklist.items)
    .filter(item => item.isMandatory && !item.isComplete);

  const checklistPenalty = incompleteMandatory.length > 0 ? 10 : 0;
  const equipment = await tx.groundEquipment.findMany();
  const maxEquipmentRisk = equipment.reduce(
    (max, item) => Math.max(max, severityToRiskFactor(item.status)),
    0
  );
  const Md = Math.max(maxEquipmentRisk, checklistPenalty);

  const totalScore = Math.min(10, Math.max(0,
    (WEIGHTS.w1 * Fs) + (WEIGHTS.w2 * Wi) + (WEIGHTS.w3 * Md)
  ));

  const calc = await tx.riskCalculations.upsert({
    where: { flightId },
    create: {
      flightId,
      totalScore,
      fatigueFactor: Fs,
      weatherFactor: Wi,
      mechFactor: Md,
    },
    update: {
      totalScore,
      fatigueFactor: Fs,
      weatherFactor: Wi,
      mechFactor: Md,
      calculatedAt: new Date(),
    }
  });

  let isCritical = false;
  let blockingReason = '';
  const threshold = await getRiskThreshold();

  if (totalScore >= threshold) {
    isCritical = true;
    blockingReason = 'Critical overall risk score.';
    eventBus.emit('alert_broadcast', {
      type: 'RISK_THRESHOLD_FAILURE',
      flightId,
      score: totalScore,
      threshold,
      timestamp: new Date().toISOString()
    });
  } else if (flight.incidents.some(incident => incident.severity === 'CRITICAL')) {
    isCritical = true;
    blockingReason = 'Unresolved critical incident on flight.';
  } else if (Wi >= threshold) {
    isCritical = true;
    blockingReason = 'Critical weather severity.';
  } else if (incompleteMandatory.length > 0) {
    isCritical = true;
    blockingReason = 'Mandatory checklist items incomplete.';
  }

  return { calc, isCritical, blockingReason };
}
