import { NextRequest } from 'next/server';
import { orchestrate, ProgressEvent } from '../../../src/orchestrator';
import type { ClientInfo } from '../../../src/types';

export const maxDuration = 600; // 10 min timeout for local dev

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY が設定されていません' }, { status: 500 });
  }

  let clientInfo: ClientInfo;
  try {
    clientInfo = await req.json();
  } catch {
    return Response.json({ error: 'リクエストの解析に失敗しました' }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const onProgress = (event: ProgressEvent) => {
        send({ type: 'progress', phase: event.phase, status: event.status });
      };

      orchestrate(clientInfo, onProgress)
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
