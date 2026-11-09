import { expect, test, vi, describe } from 'vitest';
import { calculateRisk } from '../../src/lib/risk';
import { Prisma } from '@prisma/client';

describe('calculateRisk Engine', () => {
  test('throws an error if the flight does not exist', async () => {
    const mockTx = {
      flights: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    } as unknown as Prisma.TransactionClient;

    await expect(calculateRisk('invalid-id', mockTx)).rejects.toThrow('Flight not found');
  });
  
  test('correctly aggregates fatigue and weather factors', async () => {
    const mockTx = {
      flights: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'flight-1',
          route: { baseRisk: 0.1 },
          crewUsers: [
            { shiftLogs: [{ fatigueIndex: 8 }] },
            { shiftLogs: [{ fatigueIndex: 6 }] }
          ],
          weather: [
            { severityIndex: 0.5 }
          ],
          incidents: [
            { severity: 'HIGH', resolved: false }
          ],
          checklists: []
        })
      },
      groundEquipment: {
        findMany: vi.fn().mockResolvedValue([{ status: 'MEDIUM' }])
      },
      riskCalculations: {
        upsert: vi.fn().mockImplementation((args: any) => Promise.resolve(args.create))
      }
    } as unknown as Prisma.TransactionClient;

    const result = await calculateRisk('flight-1', mockTx);

    // Fs = 7.0, Wi = 5.0, Md = 4.0
    // Rc = (0.3 x 7.0) + (0.4 x 5.0) + (0.3 x 4.0) = 5.3

    expect(result.calc.totalScore).toBeCloseTo(5.3, 2);
    expect(result.calc.weatherFactor).toBe(5.0);
    expect(result.isCritical).toBe(false);
    expect(result.blockingReason).toBe('');
  });

  test('blocks a flight when its weighted score reaches the 7.5 threshold', async () => {
    const mockTx = {
      flights: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'flight-high-risk',
          crewUsers: [{ shiftLogs: [{ fatigueIndex: 10 }] }],
          weather: [{ severityIndex: 1.0 }],
          incidents: [],
          checklists: []
        })
      },
      groundEquipment: {
        findMany: vi.fn().mockResolvedValue([{ status: 'CRITICAL' }])
      },
      riskCalculations: {
        upsert: vi.fn().mockImplementation((args: any) => Promise.resolve(args.create))
      }
    } as unknown as Prisma.TransactionClient;

    const result = await calculateRisk('flight-high-risk', mockTx);

    expect(result.calc.totalScore).toBeCloseTo(10, 2);
    expect(result.isCritical).toBe(true);
    expect(result.blockingReason).toBe('Critical overall risk score.');
  });

  test('uses a 10-point checklist penalty and blocks incomplete mandatory items', async () => {
    const mockTx = {
      flights: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'flight-checklist',
          crewUsers: [],
          weather: [],
          incidents: [],
          checklists: [{ items: [{ isMandatory: true, isComplete: false }] }]
        })
      },
      groundEquipment: {
        findMany: vi.fn().mockResolvedValue([])
      },
      riskCalculations: {
        upsert: vi.fn().mockImplementation((args: any) => Promise.resolve(args.create))
      }
    } as unknown as Prisma.TransactionClient;

    const result = await calculateRisk('flight-checklist', mockTx);

    expect(result.calc.mechFactor).toBe(10);
    expect(result.isCritical).toBe(true);
    expect(result.blockingReason).toBe('Mandatory checklist items incomplete.');
  });

  test('handles zero crew correctly without NaN', async () => {
    const mockTx = {
      flights: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'flight-1',
          route: { baseRisk: 0.1 },
          crewUsers: [],
          weather: [],
          incidents: [],
          checklists: []
        })
      },
      groundEquipment: {
        findMany: vi.fn().mockResolvedValue([])
      },
      riskCalculations: {
        upsert: vi.fn().mockImplementation((args: any) => Promise.resolve(args.create))
      }
    } as unknown as Prisma.TransactionClient;

    const result = await calculateRisk('flight-1', mockTx);

    // Fs = 0, Wi = 0, Md = 0. Total = 0.0
    expect(result.calc.totalScore).toBeCloseTo(0.0, 2);
    expect(result.isCritical).toBe(false);
  });
});
