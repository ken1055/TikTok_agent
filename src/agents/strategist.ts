import Anthropic from '@anthropic-ai/sdk';
import { ClientInfo, TrendReport, ContentStrategy } from '../types';
import { toStringArray } from '../utils';

const TOOL_NAME = 'submit_content_strategy';

const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'コンテンツ戦略ドキュメントを提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      contentPillars: {
        type: 'array',
        description: 'コンテンツの柱（3〜5つ）',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '柱の名前' },
            description: { type: 'string', description: 'この柱の目的と内容' },
            contentTypes: {
              type: 'array',
              items: { type: 'string' },
              description: 'この柱で扱う動画タイプの例'
            }
          },
          required: ['name', 'description', 'contentTypes']
        }
      },
      targetPersona: {
        type: 'string',
        description: 'TikTokで狙うターゲットペルソナの詳細（年齢・職業・悩み・価値観など）'
      },
      styleGuidelines: {
        type: 'string',
        description: '動画のスタイル・トーン・世界観のガイドライン'
      },
      postingFrequency: {
        type: 'string',
        description: '推奨投稿頻度と最適な投稿時間帯'
      }
    },
    required: ['contentPillars', 'targetPersona', 'styleGuidelines', 'postingFrequency']
  }
};

export async function runStrategist(
  client: Anthropic,
  clientInfo: ClientInfo,
  trendReport: TrendReport
): Promise<ContentStrategy> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    tools: [tool],
    tool_choice: { type: 'any' },
    system: `あなたはSNSコンテンツ戦略の専門家です。
クライアントのビジネス目標とTikTokトレンドを組み合わせて、
持続可能かつ効果的なコンテンツ戦略を設計します。
バズりやすさと企業ブランドの一貫性のバランスを重視してください。`,
    messages: [
      {
        role: 'user',
        content: `以下の情報をもとに、TikTokコンテンツ戦略を策定してください。

【クライアント情報】
会社名: ${clientInfo.companyName}
業界: ${clientInfo.industry}
サービス・商品: ${clientInfo.services}
ターゲット層: ${clientInfo.targetAudience.ageRange} / ${clientInfo.targetAudience.gender}
ターゲットの興味・関心: ${clientInfo.targetAudience.interests.join('、')}
目的: ${clientInfo.goals.join('、')}
ブランドトーン: ${clientInfo.brandTone}
補足情報: ${clientInfo.additionalInfo || 'なし'}

【リサーチャーが調査したトレンド情報】
人気フォーマット: ${trendReport.popularFormats.slice(0, 4).join('、')}
トレンドトピック: ${trendReport.trendingTopics.slice(0, 5).join('、')}
効果的なフック: ${trendReport.effectiveHooks.slice(0, 4).join('、')}

ツールを呼び出す際は以下の順序でフィールドを埋めてください：
1. contentPillars（必須・3〜4つ）
2. targetPersona（200文字以内）
3. styleGuidelines（200文字以内）
4. postingFrequency（投稿頻度と曜日・時間帯）`
      }
    ]
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (!toolUse) throw new Error('Strategist agent: ツール呼び出しが見つかりません');

  const raw = toolUse.input as Record<string, unknown>;
  // contentPillars が配列 or JSON文字列配列の両方に対応
  let rawPillars: unknown[] = [];
  if (Array.isArray(raw.contentPillars)) {
    rawPillars = raw.contentPillars;
  } else if (typeof raw.contentPillars === 'string') {
    try { rawPillars = JSON.parse(raw.contentPillars); } catch { rawPillars = []; }
  }

  return {
    contentPillars: rawPillars.map((p: unknown) => {
      const obj = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
      return {
        name: String(obj.name ?? ''),
        description: String(obj.description ?? ''),
        contentTypes: toStringArray(obj.contentTypes),
      };
    }),
    targetPersona: String(raw.targetPersona ?? ''),
    styleGuidelines: String(raw.styleGuidelines ?? ''),
    postingFrequency: String(raw.postingFrequency ?? ''),
  };
}
