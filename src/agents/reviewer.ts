import Anthropic from '@anthropic-ai/sdk';
import { ClientInfo, ContentStrategy, VideoPlan, ReviewedPlan } from '../types';
import { toStringArray } from '../utils';

const TOOL_NAME = 'submit_review_scores';

// レビューはスコア+フィードバックのみ返す（プランの全データは不要）
const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description: '各企画のバズスコアと改善提案を提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      reviews: {
        type: 'array',
        description: '各企画のレビュー結果',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number', description: '企画番号' },
            score: { type: 'number', description: 'バズ可能性スコア（1〜10）' },
            strengths: {
              type: 'array',
              items: { type: 'string' },
              description: 'この企画の強み（2〜3点）'
            },
            improvements: { type: 'string', description: '改善提案' }
          },
          required: ['id', 'score', 'strengths', 'improvements']
        }
      }
    },
    required: ['reviews']
  }
};

interface ReviewScore {
  id: number;
  score: number;
  strengths: string[];
  improvements: string;
}

export async function runReviewer(
  client: Anthropic,
  clientInfo: ClientInfo,
  strategy: ContentStrategy,
  plans: VideoPlan[]
): Promise<ReviewedPlan[]> {
  const plansText = plans
    .map(p => `企画${p.id}「${p.title}」\nフック: ${p.hook}\n柱: ${p.contentPillar}\n尺: ${p.estimatedDuration}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    tools: [tool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    system: `あなたはTikTokマーケティングの審査・品質管理の専門家です。
企画をクライアントのゴールとTikTokのアルゴリズム観点で厳しく評価し、
バズの可能性・ブランドとの一致度・実現可能性を総合的にスコアリングします。
建設的なフィードバックで企画をブラッシュアップしてください。`,
    messages: [
      {
        role: 'user',
        content: `以下の動画企画をレビューし、各企画にスコアと改善提案を付けてください。

【クライアント情報】
会社名: ${clientInfo.companyName}
業界: ${clientInfo.industry}
目的: ${clientInfo.goals.join('、')}
ブランドトーン: ${clientInfo.brandTone}

【コンテンツ戦略】
ターゲットペルソナ: ${strategy.targetPersona}
スタイルガイドライン: ${strategy.styleGuidelines}

【企画一覧】
${plansText}

【評価基準】
1. バズ可能性（フックの強さ・拡散しやすさ）
2. ブランド一致度（クライアントのトーン・目的との整合性）
3. 実現可能性（撮影・編集の難易度）
4. ターゲット適合度（ペルソナに刺さるか）

各企画について、id・score（1〜10の整数）・strengths・improvements を必ず返してください。`
      }
    ]
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (!toolUse) throw new Error('Reviewer agent: ツール呼び出しが見つかりません');

  const input = toolUse.input as Record<string, unknown>;
  let rawReviews: unknown[] = [];

  if (Array.isArray(input.reviews)) {
    rawReviews = input.reviews;
  } else if (typeof input.reviews === 'string') {
    try { rawReviews = JSON.parse(input.reviews); } catch { /* */ }
  }

  // スコアマップを作成（IDベース）
  const scoreMap = new Map<number, ReviewScore>();
  const reviewList: ReviewScore[] = [];

  for (const r of rawReviews) {
    const obj = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
    const scoreRaw = obj.score ?? obj.buzScore ?? obj.buzz_score ?? obj.buzzScore;
    const review: ReviewScore = {
      id: Number(obj.id ?? 0),
      score: Number(scoreRaw ?? 0),
      strengths: toStringArray(obj.strengths),
      improvements: String(obj.improvements ?? obj.improvement ?? ''),
    };
    scoreMap.set(review.id, review);
    reviewList.push(review);
  }

  // IDベースでマッチしなければインデックスベースにフォールバック
  const idMatchCount = plans.filter(p => scoreMap.has(p.id) && scoreMap.get(p.id)!.score > 0).length;
  const useIndexFallback = idMatchCount === 0 && reviewList.length > 0;

  return plans.map((plan, idx) => {
    const review = useIndexFallback
      ? (reviewList[idx] ?? { id: plan.id, score: 0, strengths: [], improvements: '' })
      : (scoreMap.get(plan.id) ?? { id: plan.id, score: 0, strengths: [], improvements: '' });
    return { ...plan, score: review.score, strengths: review.strengths, improvements: review.improvements };
  });
}
