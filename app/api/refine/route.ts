import { NextRequest } from 'next/server';
import { refine, RefineProgressEvent } from '../../../src/orchestrator';
import type { PlanningOutput } from '../../../src/types';

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY が設定されていません' }, { status: 500 });
  }

  const { existingOutput, refinementRequest }: {
    existingOutput: PlanningOutput;
    refinementRequest: string;
  } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const onProgress = (event: RefineProgressEvent) => {
        send({ type: 'progress', phase: event.phase, status: event.status });
      };

      refine(existingOutput, refinementRequest, onProgress)
        .then(output => {
          send({ type: 'result', data: output });
          controller.close();
        })
        .catch(err => {
          send({ type: 'error', message: String(err?.message ?? err) });
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
