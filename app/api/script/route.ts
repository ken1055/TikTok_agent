import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { runScriptWriter, refineScript } from '../../../src/agents/scriptwriter';
import type { ClientInfo, ContentStrategy, ReviewedPlan, VideoScript } from '../../../src/types';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY が設定されていません' }, { status: 500 });
  }

  const body = await req.json();
  const client = new Anthropic();

  // 台本リファイン
  if (body.action === 'refine') {
    const { script, refinementRequest, clientInfo }: {
      script: VideoScript;
      refinementRequest: string;
      clientInfo: ClientInfo;
    } = body;
    try {
      const refined = await refineScript(client, script, refinementRequest, clientInfo);
      return Response.json(refined);
    } catch (err: unknown) {
      return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
    }
  }

  // 台本新規生成
  const { clientInfo, strategy, plan, refinementRequest }: {
    clientInfo: ClientInfo;
    strategy: ContentStrategy;
    plan: ReviewedPlan;
    refinementRequest?: string;
  } = body;

  try {
    const script = await runScriptWriter(client, clientInfo, strategy, plan, refinementRequest);
    return Response.json(script);
  } catch (err: unknown) {
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
