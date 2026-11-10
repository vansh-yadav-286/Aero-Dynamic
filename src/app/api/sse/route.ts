import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { eventBus } from "@/lib/events";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const allowedRoles = ['GROUND_CREW_LEAD', 'FLIGHT_DISPATCHER', 'OPERATIONS_DIRECTOR'];
  if (!allowedRoles.includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        eventBus.off('dispatch_update', listener);
        eventBus.off('alert_broadcast', listener);
      };

      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
          closeStream();
        }
      };

      const listener = (data: unknown) => send(data);
      const keepAlive = setInterval(() => {
        send({ type: 'PING', timestamp: new Date().toISOString() });
      }, 30000);

      cleanup = closeStream;
      eventBus.on('dispatch_update', listener);
      eventBus.on('alert_broadcast', listener);

      send({ type: 'CONNECTED', timestamp: new Date().toISOString() });
      req.signal.addEventListener('abort', closeStream, { once: true });

      if (req.signal.aborted) closeStream();
    },
    cancel() {
      cleanup();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
