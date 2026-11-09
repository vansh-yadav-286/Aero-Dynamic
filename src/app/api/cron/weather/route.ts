import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { fetchWeatherSeverity } from '@/lib/services/weather';
import { calculateRisk } from '@/lib/risk';

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new NextResponse('Cron authentication is not configured.', { status: 503 });
  }

  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const activeFlights = await db.flights.findMany({
      where: { status: { in: ['SCHEDULED', 'BOARDING', 'HOLD'] } },
      include: { route: true }
    });

    let successCount = 0;
    const failedFlightIds: string[] = [];

    for (const flight of activeFlights) {
      try {
        const { severityIndex, rawData } = await fetchWeatherSeverity(flight.route.destinationId);

        await db.weatherRecords.create({
          data: {
            flightId: flight.id,
            severityIndex,
            rawData: rawData as Prisma.InputJsonValue,
          }
        });

        await calculateRisk(flight.id);
        successCount += 1;
      } catch (error) {
        failedFlightIds.push(flight.id);
        console.error(`Weather ingestion failed for flight ${flight.id}:`, error);
      }
    }

    const failedCount = failedFlightIds.length;
    return NextResponse.json({
      success: failedCount === 0,
      totalFlights: activeFlights.length,
      ingestedCount: successCount,
      failedCount,
      failedFlightIds,
    }, { status: failedCount > 0 ? 207 : 200 });
  } catch (error) {
    console.error("Weather cron failed:", error);
    return NextResponse.json({
      success: false,
      error: "Weather ingestion failed.",
    }, { status: 500 });
  }
}
