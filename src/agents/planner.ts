import Anthropic from '@anthropic-ai/sdk';
import { ClientInfo, TrendReport, ContentStrategy, VideoPlan } from '../types';
import { toStringArray } from '../utils';

const TOOL_NAME = 'submit_video_plans';

const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'TikTok動画企画リストを提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      plans: {
        type: 'array',
        description: '動画企画のリスト（8〜10本）',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number', description: '企画番号' },
            title: { type: 'string', description: '動画タイトル（視聴者向け）' },
            hook: { type: 'string', description: '冒頭1〜3秒で使うフック（視聴者が思わず見てしまう一言）' },
            structure: {
              type: 'object',
              properties: {
                opening: { type: 'string', description: '冒頭（0〜5秒）の内容' },
                bodyPoints: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '本編の展開ポイント（3〜5点）'
                },
                closing: { type: 'string', description: '締め・CTA（フォロー誘導・コメント促進など）' }
              },
              required: ['opening', 'bodyPoints', 'closing']
            },
            hashtags: {
              type: 'array',
              items: { type: 'string' },
              description: '推奨ハッシュタグ（5〜8個、#を含む）'
            },
            bgmSuggestion: {
              type: 'string',
              description: 'BGMの雰囲気・ジャンル推奨（例：明るいポップス、Lo-fiなど）'
            },
            editingStyle: {
              type: 'string',
              description: '編集スタイル（例：テロップ多め、テンポ速め、テキストオーバーレイなど）'
            },
            contentPillar: {
              type: 'string',
              description: '該当するコンテンツの柱の名前'
            },
            estimatedDuration: {
              type: 'string',
              description: '推奨動画尺（例：15秒、30秒、60秒）'
            }
          },
          required: [
            'id', 'title', 'hook', 'structure',
            'hashtags', 'bgmSuggestion', 'editingStyle',
            'contentPillar', 'estimatedDuration'
          ]
        }
      }
    },
    required: ['plans']
  }
};

export async function runPlanner(
  client: Anthropic,
  clientInfo: ClientInfo,
  trendReport: TrendReport,
  strategy: ContentStrategy,
  refinementRequest?: string,
): Promise<VideoPlan[]> {
  const pillars = strategy.contentPillars ?? [];
  const pillarsText = pillars
    .map(p => `・${p.name}: ${p.description}`)
    .join('\n') || 'コンテンツ柱は戦略エージェントが策定済み';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    tools: [tool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    system: `あなたはTikTok動画の企画・脚本の専門家です。
バズった動画の共通パターンを熟知しており、
視聴者の心理を掴む企画を次々と生み出せます。
具体的でありながら、実際に撮影・編集できる現実的な企画を提案してください。
各企画は独自性があり、互いに重複しないようにしてください。`,
    messages: [
      {
        role: 'user',
        content: `以下の情報をもとに、TikTok動画企画を8〜10本作成してください。

【クライアント情報】
会社名: ${clientInfo.companyName}
業界: ${clientInfo.industry}
サービス・商品: ${clientInfo.services}
ブランドトーン: ${clientInfo.brandTone}

【ターゲットペルソナ】
${strategy.targetPersona}

【コンテンツの柱】
${pillarsText}

【スタイルガイドライン】
${strategy.styleGuidelines}

【トレンド情報】
人気フォーマット: ${trendReport.popularFormats.join('、')}
トレンドトピック: ${trendReport.trendingTopics.join('、')}
効果的なフック例: ${trendReport.effectiveHooks.join('、')}

各コンテンツの柱をバランスよくカバーしながら、
トレンドを活用した具体的な動画企画を8〜10本作成してください。
フックは特に視聴者が「これ見たい！」と思えるものにしてください。${refinementRequest ? `\n\n【改善リクエスト】\n${refinementRequest}\n上記の改善リクエストを反映した企画を作成してください。` : ''}`
      }
    ]
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (!toolUse) {
    console.error('[Planner] stop_reason:', response.stop_reason);
    console.error('[Planner] レスポンス内容:', JSON.stringify(response.content, null, 2));
    throw new Error('Planner agent: ツール呼び出しが見つかりません');
  }

  const input = toolUse.input as Record<string, unknown>;

  // plans キーの取り出し: 配列 / JSON文字列 / ルートが配列 のいずれにも対応
  let rawPlans: unknown[] = [];
  if (Array.isArray(input.plans)) {
    rawPlans = input.plans;
  } else if (typeof input.plans === 'string') {
    try { rawPlans = JSON.parse(input.plans); } catch { rawPlans = []; }
  } else if (Array.isArray(input)) {
    rawPlans = input;
  }

  if (rawPlans.length === 0) {
    const plansVal = (input as Record<string, unknown>).plans;
    console.error('[Planner] plans が空。typeof plans:', typeof plansVal, '| isArray:', Array.isArray(plansVal));
    if (plansVal !== undefined) console.error('[Planner] plans の内容(先頭200文字):', JSON.stringify(plansVal)?.slice(0, 200));
  }

  return rawPlans.map((p: unknown, idx: number) => {
    const obj = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    const structure = (obj.structure ?? {}) as Record<string, unknown>;
    return {
      id: Number(obj.id ?? idx + 1),
      title: String(obj.title ?? ''),
      hook: String(obj.hook ?? ''),
      structure: {
        opening: String(structure.opening ?? ''),
        bodyPoints: toStringArray(structure.bodyPoints),
        closing: String(structure.closing ?? ''),
      },
      hashtags: toStringArray(obj.hashtags),
      bgmSuggestion: String(obj.bgmSuggestion ?? ''),
      editingStyle: String(obj.editingStyle ?? ''),
      contentPillar: String(obj.contentPillar ?? ''),
      estimatedDuration: String(obj.estimatedDuration ?? ''),
    };
  });
}
