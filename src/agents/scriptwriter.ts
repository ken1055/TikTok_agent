import Anthropic from '@anthropic-ai/sdk';
import { ClientInfo, ContentStrategy, ReviewedPlan, VideoScript, ScriptScene } from '../types';
import { toStringArray } from '../utils';

const TOOL_NAME = 'submit_script';

const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'TikTok動画の台本を提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      totalDuration: { type: 'string', description: '合計尺（例：60秒）' },
      scenes: {
        type: 'array',
        description: 'シーン一覧',
        items: {
          type: 'object',
          properties: {
            timeCode:  { type: 'string', description: '時間コード（例：0:00-0:05）' },
            sceneType: { type: 'string', enum: ['hook', 'body', 'closing'], description: 'シーンの種類' },
            narration: { type: 'string', description: 'ナレーション・セリフ（話す内容）' },
            action:    { type: 'string', description: '映像・動作の指示（何を映すか）' },
            caption:   { type: 'string', description: '画面上のテロップ・テキスト' },
          },
          required: ['timeCode', 'sceneType', 'narration', 'action', 'caption'],
        },
      },
      productionNotes: { type: 'string', description: '撮影・編集上の注意点・補足' },
    },
    required: ['totalDuration', 'scenes', 'productionNotes'],
  },
};

export async function runScriptWriter(
  client: Anthropic,
  clientInfo: ClientInfo,
  strategy: ContentStrategy,
  plan: ReviewedPlan,
  refinementRequest?: string,
): Promise<VideoScript> {
  const structureText = [
    `冒頭: ${plan.structure.opening}`,
    ...plan.structure.bodyPoints.map((p, i) => `本編${i + 1}: ${p}`),
    `締め: ${plan.structure.closing}`,
  ].join('\n');

  const refineSection = refinementRequest
    ? `\n【修正リクエスト】\n${refinementRequest}\n`
    : '';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    tools: [tool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    system: `あなたはTikTok動画の台本作家・ディレクターです。
バズる動画の台本を数多く手がけており、視聴者を惹きつけるナレーション・映像演出・テロップの組み合わせを熟知しています。
縦型ショート動画に特化した、実際に撮影・編集できる具体的な台本を作成してください。`,
    messages: [
      {
        role: 'user',
        content: `以下の動画企画をもとに、TikTok縦型ショート動画の台本を作成してください。${refineSection}

【クライアント情報】
会社名: ${clientInfo.companyName}
業界: ${clientInfo.industry}
ブランドトーン: ${clientInfo.brandTone}

【コンテンツ戦略】
ターゲットペルソナ: ${strategy.targetPersona}
スタイルガイドライン: ${strategy.styleGuidelines}

【対象企画】
タイトル: ${plan.title}
フック: ${plan.hook}
尺: ${plan.estimatedDuration}
BGM: ${plan.bgmSuggestion}
編集スタイル: ${plan.editingStyle}

【構成】
${structureText}

【台本の要件】
- シーンごとに「時間コード」「ナレーション/セリフ」「映像指示」「テロップ」を明記
- フックは冒頭3秒以内で完結させる
- ブランドトーンに合った言葉づかい・演出にする
- 視聴完了率を上げるため、テンポよく展開する
- 実際に撮影・編集できる現実的な指示にする`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) throw new Error('ScriptWriter: ツール呼び出しが見つかりません');

  const input = toolUse.input as Record<string, unknown>;
  const rawScenes = Array.isArray(input.scenes) ? input.scenes : [];

  const scenes: ScriptScene[] = rawScenes.map((s: unknown) => {
    const obj = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    return {
      timeCode:  String(obj.timeCode ?? ''),
      sceneType: (['hook', 'body', 'closing'].includes(String(obj.sceneType)) ? obj.sceneType : 'body') as ScriptScene['sceneType'],
      narration: String(obj.narration ?? ''),
      action:    String(obj.action ?? ''),
      caption:   String(obj.caption ?? ''),
    };
  });

  return {
    planId:          plan.id,
    planTitle:       plan.title,
    totalDuration:   String(input.totalDuration ?? plan.estimatedDuration),
    scenes,
    productionNotes: String(input.productionNotes ?? ''),
  };
}

export async function refineScript(
  client: Anthropic,
  script: VideoScript,
  refinementRequest: string,
  clientInfo: ClientInfo,
): Promise<VideoScript> {
  const scriptText = script.scenes.map(s =>
    `[${s.timeCode} - ${s.sceneType}]\n映像: ${s.action}\nナレーション: ${s.narration}\nテロップ: ${s.caption}`,
  ).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    tools: [tool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    system: `あなたはTikTok動画の台本作家・ディレクターです。既存の台本を修正リクエストに従って改善してください。`,
    messages: [
      {
        role: 'user',
        content: `以下の台本を修正してください。

【修正リクエスト】
${refinementRequest}

【現在の台本】
タイトル: ${script.planTitle}
合計尺: ${script.totalDuration}
ブランドトーン: ${clientInfo.brandTone}

${scriptText}

注意事項:
- 修正リクエストに対応しながら、全体の流れは維持してください
- 修正箇所以外も自然になるよう調整してください
- totalDuration・scenes・productionNotes を全て返してください`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) throw new Error('ScriptRefiner: ツール呼び出しが見つかりません');

  const input = toolUse.input as Record<string, unknown>;
  const rawScenes = Array.isArray(input.scenes) ? input.scenes : [];

  const scenes: ScriptScene[] = rawScenes.map((s: unknown) => {
    const obj = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    return {
      timeCode:  String(obj.timeCode ?? ''),
      sceneType: (['hook', 'body', 'closing'].includes(String(obj.sceneType)) ? obj.sceneType : 'body') as ScriptScene['sceneType'],
      narration: String(obj.narration ?? ''),
      action:    String(obj.action ?? ''),
      caption:   String(obj.caption ?? ''),
    };
  });

  return {
    ...script,
    totalDuration:   String(input.totalDuration ?? script.totalDuration),
    scenes,
    productionNotes: String(input.productionNotes ?? ''),
  };
}
