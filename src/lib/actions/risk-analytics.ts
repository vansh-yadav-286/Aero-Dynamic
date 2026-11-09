'use server';

import { db } from "@/lib/db";
import { Severity } from "@prisma/client";
import { calculateRisk } from "@/lib/risk";

// Keep director analytics on the exact same risk calculator used by dispatch gates.
async function computeFlightRisk(flightId: string) {
  const { calc } = await calculateRisk(flightId);

  return {
    totalScore: calc.totalScore,
    fatigueFactor: calc.fatigueFactor,
    weatherFactor: calc.weatherFactor,
    mechFactor: calc.mechFactor,
  };
}

// Refresh missing or older-than-15-minute risk records for monitored flights.
async function ensureRiskCalculations(flightIds: string[]) {
  const existing = await db.riskCalculations.findMany({
    where: { flightId: { in: flightIds } },
    select: { flightId: true, calculatedAt: true }
  });
  const existingById = new Map(existing.map(record => [record.flightId, record.calculatedAt]));
  const staleBefore = Date.now() - 15 * 60 * 1000;
  const refreshIds = flightIds.filter(id => {
    const calculatedAt = existingById.get(id);
    return !calculatedAt || calculatedAt.getTime() < staleBefore;
  });

  if (refreshIds.length === 0) return;

  const flights = await db.flights.findMany({
    where: { id: { in: refreshIds } },
    select: { id: true, flightNumber: true }
  });

  for (const flight of flights) {
    const factors = await computeFlightRisk(flight.id);
    const wasMissing = !existingById.has(flight.id);
    const maxFactor = Math.max(factors.fatigueFactor, factors.weatherFactor, factors.mechFactor);

    let alertSeverity: Severity | null = null;
    let alertReason = '';

    if (factors.totalScore >= 7.5 || maxFactor >= 9.0) {
      alertSeverity = Severity.CRITICAL;
      alertReason = 'CRITICAL RISK';
    } else if (factors.totalScore >= 5.0 || maxFactor >= 7.0) {
      alertSeverity = Severity.HIGH;
      alertReason = 'HIGH RISK';
    } else if (factors.totalScore >= 2.5 || maxFactor >= 5.0) {
      alertSeverity = Severity.MEDIUM;
      alertReason = 'ELEVATED RISK';
    }

    if (wasMissing && alertSeverity) {
      const driverLabel =
        factors.fatigueFactor === maxFactor ? `Fatigue spike (${factors.fatigueFactor.toFixed(1)}/10)` :
        factors.weatherFactor === maxFactor ? `Weather severity (${factors.weatherFactor.toFixed(1)}/10)` :
        `Mechanical index (${factors.mechFactor.toFixed(1)}/10)`;

      await db.alertLogs.create({
        data: {
          severity: alertSeverity,
          read: false,
          message: `${alertReason}: Flight ${flight.flightNumber} — Total ${factors.totalScore.toFixed(1)}/10 · ${driverLabel}`
        }
      });
    }
  }
}

export async function getDashboardStats() {
  const config = await db.systemConfig.findUnique({ where: { key: 'monitored_flight_ids' } });
  let monitoredIds: string[] | null = null;
  if (config) {
    try { monitoredIds = JSON.parse(config.value); } catch {}
  }

  const flightsCount = monitoredIds?.length ?? await db.flights.count();

  if (monitoredIds && monitoredIds.length > 0) {
    await ensureRiskCalculations(monitoredIds);
  }

  let alertsCount = 0;
  if (monitoredIds && monitoredIds.length > 0) {
    const risks = await db.riskCalculations.findMany({
      where: { flightId: { in: monitoredIds } },
      select: { totalScore: true, fatigueFactor: true, weatherFactor: true, mechFactor: true }
    });
    alertsCount = risks.filter(r => {
      const maxFactor = Math.max(r.fatigueFactor, r.weatherFactor, r.mechFactor);
      return r.totalScore >= 2.5 || maxFactor >= 5.0;
    }).length;
  }

  return { flightsCount, alertsCount };
}

export async function getCombinedRiskFactors() {
  const config = await db.systemConfig.findUnique({ where: { key: 'monitored_flight_ids' } });
  let monitoredIds: string[] | null = null;
  if (config) {
    try { monitoredIds = JSON.parse(config.value); } catch {}
  }

  if (!monitoredIds || monitoredIds.length === 0) {
    return { totalAverage: 0, fatigueAverage: 0, weatherAverage: 0, mechAverage: 0, count: 0 };
  }

  await ensureRiskCalculations(monitoredIds);

  const risks = await db.riskCalculations.findMany({
    where: { flightId: { in: monitoredIds } }
  });

  if (risks.length === 0) {
    return { totalAverage: 0, fatigueAverage: 0, weatherAverage: 0, mechAverage: 0, count: 0 };
  }

  const sums = risks.reduce((acc, risk) => ({
    total: acc.total + risk.totalScore,
    fatigue: acc.fatigue + risk.fatigueFactor,
    weather: acc.weather + risk.weatherFactor,
    mech: acc.mech + risk.mechFactor
  }), { total: 0, fatigue: 0, weather: 0, mech: 0 });

  return {
    totalAverage: sums.total / risks.length,
    fatigueAverage: sums.fatigue / risks.length,
    weatherAverage: sums.weather / risks.length,
    mechAverage: sums.mech / risks.length,
    count: risks.length
  };
}

export async function updateMonitoredFlights(flightIds: string[]) {
  await db.systemConfig.upsert({
    where: { key: 'monitored_flight_ids' },
    update: { value: JSON.stringify(flightIds) },
    create: { key: 'monitored_flight_ids', value: JSON.stringify(flightIds) }
  });
}

export async function getMonitoredFlightIds(): Promise<string[] | null> {
  const config = await db.systemConfig.findUnique({ where: { key: 'monitored_flight_ids' } });
  if (config) {
    try { return JSON.parse(config.value) as string[]; } catch {}
  }
  return null;
}
