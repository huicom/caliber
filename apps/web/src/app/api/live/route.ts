export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval>;
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const { default: postgres } = await import('postgres');
      const listenSql = postgres(process.env.DATABASE_URL!, {
        max: 1,
        idle_timeout: 0,
      });

      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`,
        ),
      );

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`,
            ),
          );
        } catch {
          cleanup?.();
        }
      }, 15_000);

      const listenHandle = await listenSql.listen(
        'arc_events',
        (payload) => {
          try {
            controller.enqueue(
              encoder.encode(`event: arc_event\ndata: ${payload}\n\n`),
            );
          } catch {
            cleanup?.();
          }
        },
      );

      cleanup = () => {
        clearInterval(heartbeat);
        listenHandle.unlisten().catch(() => {});
        listenSql.end().catch(() => {});
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
