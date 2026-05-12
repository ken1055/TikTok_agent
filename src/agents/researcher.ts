import Anthropic from '@anthropic-ai/sdk';
import { ClientInfo, TrendReport } from '../types';
import { toStringArray } from '../utils';

const TOOL_NAME = 'submit_trend_report';

const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'TikTokトレンドリサーチレポートを提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      popularFormats: {
        type: 'array',
        items: { type: 'string' },
        description: '現在TikTokで人気の動画フォーマット（例：ルーティン紹介、Before/After、Q&A形式など）'
      },
      trendingTopics: {
        type: 'array',
        items: { type: 'string' },
        description: 'この業界のTikTokで今トレンドのトピック・テーマ'
      },
      effectiveHooks: {
        type: 'array',
        items: { type: 'string' },
        description: '視聴者を引き込む効果的なフック文例（冒頭1〜3秒で使えるもの）'
      },
      competitorInsights: {
        type: 'string',
        description: '同業界・競合のTikTokアカウントの傾向と成功パターンの分析'
      }
    },
    required: ['popularFormats', 'trendingTopics', 'effectiveHooks', 'competitorInsights']
  }
};

export async function runResearcher(
  client: Anthropic,
  clientInfo: ClientInfo
): Promise<TrendReport> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    tools: [tool],
    tool_choice: { type: 'any' },
    system: `あなたはTikTokマーケティングの専門リサーチャーです。
クライアントの業界・ターゲット層に最適なTikTokトレンドを深く分析してください。
日本のTikTokトレンドを中心に、グローバルなトレンドも踏まえて分析します。
具体的で実用的な情報を提供することを最優先にしてください。`,
    messages: [
      {
        role: 'user',
        content: `以下のクライアント情報に基づき、TikTokトレンドリサーチを実施してください。

【クライアント情報】
会社名: ${clientInfo.companyName}
業界: ${clientInfo.industry}
サービス・商品: ${clientInfo.services}
ターゲット層: ${clientInfo.targetAudience.ageRange} / ${clientInfo.targetAudience.gender}
ターゲットの興味・関心: ${clientInfo.targetAudience.interests.join('、')}
目的: ${clientInfo.goals.join('、')}
参考アカウント: ${clientInfo.referenceAccounts?.join('、') || 'なし'}
補足情報: ${clientInfo.additionalInfo || 'なし'}

このクライアントに最適なTikTokトレンドを分析し、具体的な動画フォーマット・トピック・フック例・競合分析をレポートしてください。`
      }
    ]
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (!toolUse) throw new Error('Researcher agent: ツール呼び出しが見つかりません');

  const raw = toolUse.input as Record<string, unknown>;
  return {
    popularFormats: toStringArray(raw.popularFormats),
    trendingTopics: toStringArray(raw.trendingTopics),
    effectiveHooks: toStringArray(raw.effectiveHooks),
    competitorInsights: String(raw.competitorInsights ?? ''),
  };
}
