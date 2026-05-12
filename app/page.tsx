'use client';

import { useState, useRef } from 'react';
import type { ClientInfo, PlanningOutput, ReviewedPlan, VideoScript } from '../src/types';

// ─── Sample data ───────────────────────────────────────────
const SAMPLE: ClientInfo = {
  companyName: 'リラクゼーションサロン CALM',
  industry: '美容・ウェルネス',
  services: '全身もみほぐし・アロマトリートメント・ヘッドスパ。1回3500円〜、完全予約制。都内に3店舗展開。',
  targetAudience: {
    ageRange: '20〜40代',
    gender: '女性メイン（男性も歓迎）',
    interests: ['美容', 'セルフケア', 'リラックス', '健康', '疲労回復'],
  },
  goals: ['brand_awareness', 'followers', 'lead_generation'],
  brandTone: '穏やかで上品、でも親しみやすい。「癒し」と「丁寧さ」を大切にしている',
  referenceAccounts: ['@relaxation_beauty', '@spa_lifestyle_jp'],
  additionalInfo: 'スタッフが若い女性中心で、SNS発信が得意。予約はLINEで受付中。',
};

// ─── Types ─────────────────────────────────────────────────
type Phase = 'form' | 'loading' | 'done';
type PhaseStatus = 'pending' | 'active' | 'done';
interface ProgressState {
  research: PhaseStatus;
  strategy: PhaseStatus;
  planning: PhaseStatus;
  review: PhaseStatus;
}
type ScriptPhase = 'idle' | 'loading' | 'done' | 'refining';

const PHASE_LABELS: Record<keyof ProgressState, string> = {
  research: 'フェーズ1: TikTokトレンドリサーチ',
  strategy: 'フェーズ2: コンテンツ戦略策定',
  planning: 'フェーズ3: 動画企画生成（8〜10本）',
  review:   'フェーズ4: 企画レビュー・スコアリング',
};

const REFINE_PHASE_LABELS: Record<string, string> = {
  planning: 'プランを再生成中...',
  review:   'スコアリング中...',
};

// ─── SSE stream helper ──────────────────────────────────────
async function streamPost<T>(
  url: string,
  body: object,
  onProgress: (phase: string, status: string) => void,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error ?? 'サーバーエラー');
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6));
      if (data.type === 'progress') onProgress(data.phase, data.status);
      else if (data.type === 'result') result = data.data as T;
      else if (data.type === 'error') throw new Error(data.message);
    }
  }
  if (!result) throw new Error('レスポンスが空です');
  return result;
}

// ─── Sub-components ─────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const filled = Math.round(score / 2);
  return (
    <span className="score-badge">
      {'★'.repeat(filled)}{'☆'.repeat(5 - filled)} {score}/10
    </span>
  );
}

function ScriptView({
  plan,
  clientInfo,
  strategy,
}: {
  plan: ReviewedPlan;
  clientInfo: ClientInfo;
  strategy: PlanningOutput['contentStrategy'];
}) {
  const [scriptPhase, setScriptPhase] = useState<ScriptPhase>('idle');
  const [script, setScript] = useState<VideoScript | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [aiRequest, setAiRequest] = useState('');
  const [aiRefining, setAiRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function scriptToText(s: VideoScript): string {
    return s.scenes.map(sc =>
      `[${sc.timeCode} - ${sc.sceneType === 'hook' ? 'フック' : sc.sceneType === 'closing' ? 'クロージング' : '本編'}]\n映像・動作: ${sc.action}\nナレーション: ${sc.narration}\nテロップ: ${sc.caption}`
    ).join('\n\n') + (s.productionNotes ? `\n\n【制作メモ】\n${s.productionNotes}` : '');
  }

  async function generateScript() {
    setScriptPhase('loading');
    setError(null);
    try {
      const res = await fetch('/api/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientInfo, strategy, plan }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setScript(data);
      setEditedText(scriptToText(data));
      setScriptPhase('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setScriptPhase('idle');
    }
  }

  async function handleAiRefine() {
    if (!script || !aiRequest.trim()) return;
    setAiRefining(true);
    setError(null);
    try {
      const res = await fetch('/api/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refine', script, refinementRequest: aiRequest, clientInfo }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setScript(data);
      setEditedText(scriptToText(data));
      setAiRequest('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiRefining(false);
    }
  }

  if (scriptPhase === 'idle') {
    return (
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <button className="btn btn-script" onClick={generateScript}>
          📝 この企画で台本を作成
        </button>
      </div>
    );
  }

  if (scriptPhase === 'loading') {
    return (
      <div className="script-loading">
        <span className="spinner" style={{ display: 'inline-block' }} />
        <span style={{ marginLeft: 10 }}>台本を生成中...（30〜60秒）</span>
      </div>
    );
  }

  return (
    <div className="script-area">
      <div className="script-header">
        <strong>📝 台本：{script?.planTitle}</strong>
        <span className="tag">{script?.totalDuration}</span>
        <div className="script-actions">
          <button
            className="btn btn-secondary"
            style={{ padding: '6px 14px', fontSize: 13 }}
            onClick={() => setEditMode(v => !v)}
          >
            {editMode ? '✅ 編集を終了' : '✏️ 手動で編集'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: '6px 14px', fontSize: 13 }}
            onClick={generateScript}
          >
            🔄 再生成
          </button>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {editMode ? (
        <textarea
          className="script-editor"
          value={editedText}
          onChange={e => setEditedText(e.target.value)}
          rows={20}
        />
      ) : (
        <div className="script-scenes">
          {script?.scenes.map((sc, i) => (
            <div key={i} className={`scene-block scene-${sc.sceneType}`}>
              <div className="scene-header">
                <span className="scene-timecode">{sc.timeCode}</span>
                <span className="scene-type-badge">
                  {sc.sceneType === 'hook' ? 'フック' : sc.sceneType === 'closing' ? 'クロージング' : '本編'}
                </span>
              </div>
              <div className="scene-row"><span className="scene-label">🎬 映像</span><span>{sc.action}</span></div>
              <div className="scene-row"><span className="scene-label">🗣 ナレーション</span><span>「{sc.narration}」</span></div>
              {sc.caption && <div className="scene-row"><span className="scene-label">📝 テロップ</span><span>{sc.caption}</span></div>}
            </div>
          ))}
          {script?.productionNotes && (
            <div className="production-notes">
              <strong>制作メモ：</strong>{script.productionNotes}
            </div>
          )}
        </div>
      )}

      {/* AI refinement */}
      <div className="ai-refine-area">
        <div className="section-label" style={{ marginBottom: 8 }}>💬 AIに台本の修正をリクエスト</div>
        <div className="ai-refine-input-row">
          <input
            type="text"
            className="ai-refine-input"
            placeholder="例：もっとテンポよくして、テロップを増やしてください"
            value={aiRequest}
            onChange={e => setAiRequest(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiRefine(); } }}
            disabled={aiRefining}
          />
          <button
            className="btn btn-primary"
            style={{ padding: '8px 18px', fontSize: 13, whiteSpace: 'nowrap' }}
            onClick={handleAiRefine}
            disabled={aiRefining || !aiRequest.trim()}
          >
            {aiRefining ? <span className="spinner" style={{ display: 'inline-block', width: 14, height: 14 }} /> : '送信'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  rank,
  clientInfo,
  strategy,
}: {
  plan: ReviewedPlan;
  rank: number;
  clientInfo: ClientInfo;
  strategy: PlanningOutput['contentStrategy'];
}) {
  const [showScript, setShowScript] = useState(false);

  return (
    <div className="plan-card" data-score={plan.score}>
      <div className="plan-header">
        <div>
          <div className="plan-rank">#{rank} ランク</div>
          <div className="plan-title">【{plan.title}】</div>
        </div>
        <ScoreBadge score={plan.score} />
      </div>

      <div className="plan-meta">
        <span className="tag">📌 {plan.contentPillar}</span>
        <span className="tag">⏱ {plan.estimatedDuration}</span>
      </div>

      <div className="plan-hook">
        🎣 フック（冒頭）：「{plan.hook}」
      </div>

      <div className="section-label">📹 構成</div>
      <ul className="structure-list">
        <li className="structure-item">
          <span className="structure-label">[冒頭]</span>
          <span>{plan.structure.opening}</span>
        </li>
        {plan.structure.bodyPoints.map((pt, i) => (
          <li key={i} className="structure-item">
            <span className="structure-label">[本編{i + 1}]</span>
            <span>{pt}</span>
          </li>
        ))}
        <li className="structure-item">
          <span className="structure-label">[締め]</span>
          <span>{plan.structure.closing}</span>
        </li>
      </ul>

      <div className="plan-sub-grid">
        <div>
          <div className="section-label">🎵 BGM</div>
          <div style={{ fontSize: 13 }}>{plan.bgmSuggestion}</div>
        </div>
        <div>
          <div className="section-label">✂️ 編集スタイル</div>
          <div style={{ fontSize: 13 }}>{plan.editingStyle}</div>
        </div>
      </div>

      <div className="hashtags">{plan.hashtags.join(' ')}</div>

      {plan.strengths.length > 0 && (
        <>
          <div className="section-label">💪 強み</div>
          <ul className="strengths-list">
            {plan.strengths.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </>
      )}

      {plan.improvements && (
        <div className="improvements">
          💡 改善提案：{plan.improvements}
        </div>
      )}

      {/* Script section */}
      <div className="script-divider" />
      {showScript ? (
        <ScriptView plan={plan} clientInfo={clientInfo} strategy={strategy} />
      ) : (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button className="btn btn-script" onClick={() => setShowScript(true)}>
            📝 この企画で台本を作成
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────
export default function HomePage() {
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState<ProgressState>({
    research: 'pending', strategy: 'pending', planning: 'pending', review: 'pending',
  });
  const [result, setResult] = useState<PlanningOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTrend, setShowTrend] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);

  // Refinement state
  const [refineInput, setRefineInput] = useState('');
  const [refinePhase, setRefinePhase] = useState<'idle' | 'loading'>('idle');
  const [refineProgress, setRefineProgress] = useState<Record<string, string>>({});

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('');
  const [services, setServices] = useState('');
  const [ageRange, setAgeRange] = useState('');
  const [gender, setGender] = useState('');
  const [interests, setInterests] = useState('');
  const [goals, setGoals] = useState<string[]>(['brand_awareness']);
  const [brandTone, setBrandTone] = useState('');
  const [refAccounts, setRefAccounts] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');

  const refineRef = useRef<HTMLDivElement>(null);

  function loadSample() {
    setCompanyName(SAMPLE.companyName);
    setIndustry(SAMPLE.industry);
    setServices(SAMPLE.services);
    setAgeRange(SAMPLE.targetAudience.ageRange);
    setGender(SAMPLE.targetAudience.gender);
    setInterests(SAMPLE.targetAudience.interests.join(', '));
    setGoals([...SAMPLE.goals]);
    setBrandTone(SAMPLE.brandTone);
    setRefAccounts((SAMPLE.referenceAccounts ?? []).join(', '));
    setAdditionalInfo(SAMPLE.additionalInfo ?? '');
  }

  function toggleGoal(g: string) {
    setGoals(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }

  function updateProgress(phase: string, status: string) {
    const order: (keyof ProgressState)[] = ['research', 'strategy', 'planning', 'review'];
    setProgress(prev => {
      const next = { ...prev };
      if (status === 'start') next[phase as keyof ProgressState] = 'active';
      if (status === 'done')  next[phase as keyof ProgressState] = 'done';
      const idx = order.indexOf(phase as keyof ProgressState);
      if (status === 'done' && idx + 1 < order.length) {
        next[order[idx + 1]] = 'active';
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const clientInfo: ClientInfo = {
      companyName, industry, services,
      targetAudience: {
        ageRange, gender,
        interests: interests.split(',').map(s => s.trim()).filter(Boolean),
      },
      goals: goals as ClientInfo['goals'],
      brandTone,
      referenceAccounts: refAccounts ? refAccounts.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      additionalInfo: additionalInfo || undefined,
    };

    setPhase('loading');
    setProgress({ research: 'active', strategy: 'pending', planning: 'pending', review: 'pending' });

    try {
      const output = await streamPost<PlanningOutput>(
        '/api/generate', clientInfo, updateProgress,
      );
      setResult(output);
      setPhase('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('form');
    }
  }

  async function handleRefine() {
    if (!result || !refineInput.trim()) return;
    setRefinePhase('loading');
    setRefineProgress({});
    try {
      const output = await streamPost<PlanningOutput>(
        '/api/refine',
        { existingOutput: result, refinementRequest: refineInput },
        (phase, status) => setRefineProgress(prev => ({ ...prev, [phase]: status })),
      );
      setResult(output);
      setRefineInput('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefinePhase('idle');
    }
  }

  function handleReset() {
    setPhase('form');
    setResult(null);
    setError(null);
    setProgress({ research: 'pending', strategy: 'pending', planning: 'pending', review: 'pending' });
  }

  // ─── Loading screen ───
  if (phase === 'loading') {
    return (
      <>
        <header>
          <div className="header-inner">
            <span className="header-logo">🎵</span>
            <div>
              <div className="header-title">TikTok企画生成ツール</div>
              <div className="header-sub">AIエージェントチームが稼働中</div>
            </div>
          </div>
        </header>
        <div className="container">
          <div className="card">
            <div className="progress-wrap">
              <div className="progress-title">AIエージェントチームが分析中...</div>
              <div className="progress-sub">完了まで3〜5分かかります。このままお待ちください。</div>
              <ul className="phase-list">
                {(Object.entries(PHASE_LABELS) as [keyof ProgressState, string][]).map(([key, label]) => (
                  <li key={key} className={`phase-item ${progress[key]}`}>
                    <span className="phase-icon">
                      {progress[key] === 'done'   ? '✅'
                       : progress[key] === 'active' ? <span className="spinner" />
                       : '⬜'}
                    </span>
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── Results screen ───
  if (phase === 'done' && result) {
    const avg = result.videoplans.reduce((s, p) => s + p.score, 0) / result.videoplans.length;
    const tr = result.trendReport;

    return (
      <>
        <header>
          <div className="header-inner">
            <span className="header-logo">🎵</span>
            <div>
              <div className="header-title">TikTok動画企画書</div>
              <div className="header-sub">{result.clientInfo.companyName}</div>
            </div>
          </div>
        </header>
        <div className="container">

          {/* Top card */}
          <div className="card">
            <div className="result-header">
              <div>
                <div className="result-meta">
                  生成日時：{new Date(result.generatedAt).toLocaleString('ja-JP')} ／ 企画数：{result.videoplans.length}本
                </div>
                <span className="avg-score">平均バズスコア {avg.toFixed(1)} / 10</span>
              </div>
              <div className="result-actions no-print">
                <button className="btn btn-print" onClick={() => window.print()}>📄 PDFで保存</button>
                <button className="btn btn-secondary" onClick={handleReset}>↩ 新しく生成</button>
              </div>
            </div>
          </div>

          {/* Trend report */}
          <div className="card">
            <h2>📊 トレンドリサーチ結果</h2>
            <button className="strategy-toggle no-print" onClick={() => setShowTrend(v => !v)}>
              {showTrend ? '詳細を隠す ▲' : '詳細を表示 ▼'}
            </button>
            {showTrend && (
              <div className="strategy-body">
                <div style={{ marginBottom: 14 }}>
                  <div className="section-label">🔥 人気フォーマット</div>
                  <ul className="trend-list">
                    {tr.popularFormats.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div className="section-label"># トレンドトピック</div>
                  <ul className="trend-list">
                    {tr.trendingTopics.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div className="section-label">🎣 効果的なフック例</div>
                  <ul className="trend-list">
                    {tr.effectiveHooks.map((h, i) => <li key={i}>「{h}」</li>)}
                  </ul>
                </div>
                <div>
                  <div className="section-label">🔍 競合分析</div>
                  <div style={{ fontSize: 13 }}>{tr.competitorInsights}</div>
                </div>
              </div>
            )}
          </div>

          {/* Content strategy */}
          <div className="card">
            <h2>🎯 コンテンツ戦略</h2>
            <div style={{ fontSize: 14, marginBottom: 6 }}>
              <strong>ターゲットペルソナ：</strong>{result.contentStrategy.targetPersona}
            </div>
            <button className="strategy-toggle no-print" onClick={() => setShowStrategy(v => !v)}>
              {showStrategy ? 'コンテンツの柱を隠す ▲' : 'コンテンツの柱を表示 ▼'}
            </button>
            {showStrategy && (
              <div className="strategy-body">
                <ul className="pillar-list">
                  {result.contentStrategy.contentPillars.map((p, i) => (
                    <li key={i} className="pillar-item">
                      <div className="pillar-name">【{p.name}】</div>
                      <div className="pillar-desc">{p.description}</div>
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 14, fontSize: 14 }}>
                  <strong>スタイルガイドライン：</strong>{result.contentStrategy.styleGuidelines}
                </div>
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  <strong>推奨投稿頻度：</strong>{result.contentStrategy.postingFrequency}
                </div>
              </div>
            )}
          </div>

          {/* Refinement panel */}
          <div className="card no-print" ref={refineRef}>
            <h2>✨ 企画を改善する</h2>
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
            {refinePhase === 'loading' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                <span className="spinner" />
                <span style={{ fontSize: 14 }}>
                  {refineProgress.planning === 'active' ? REFINE_PHASE_LABELS.planning
                   : refineProgress.review === 'active' ? REFINE_PHASE_LABELS.review
                   : '処理中...'}
                </span>
              </div>
            ) : (
              <div className="refine-row">
                <input
                  type="text"
                  className="refine-input"
                  placeholder="例：もっと20代のOLに刺さるフックにしてください / ヘッドスパの企画を増やして"
                  value={refineInput}
                  onChange={e => setRefineInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRefine(); } }}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleRefine}
                  disabled={!refineInput.trim()}
                >
                  🔄 再生成
                </button>
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              ※ リサーチ・戦略はそのままで、企画プランのみ再生成します（約2〜3分）
            </div>
          </div>

          {/* Plan cards */}
          <div>
            <div className="card" style={{ padding: '16px 28px' }}>
              <h2 style={{ marginBottom: 0 }}>🎬 動画企画一覧（スコア順）</h2>
            </div>
            {result.videoplans.map((plan, i) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                rank={i + 1}
                clientInfo={result.clientInfo}
                strategy={result.contentStrategy}
              />
            ))}
          </div>
        </div>
      </>
    );
  }

  // ─── Form screen ───
  return (
    <>
      <header>
        <div className="header-inner">
          <span className="header-logo">🎵</span>
          <div>
            <div className="header-title">TikTok企画生成ツール</div>
            <div className="header-sub">クライアント情報を入力して企画を自動生成</div>
          </div>
        </div>
      </header>
      <div className="container">
        {error && (
          <div className="card" style={{ background: '#fff5f5', borderLeft: '4px solid #e17055', marginTop: 24 }}>
            <strong>エラー：</strong>{error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="card">
            <h2>🏢 クライアント情報</h2>
            <div className="form-grid">
              <div className="field">
                <label>会社名 / サロン名<span className="req">*</span></label>
                <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="例：リラクゼーションサロン CALM" required />
              </div>
              <div className="field">
                <label>業界<span className="req">*</span></label>
                <input type="text" value={industry} onChange={e => setIndustry(e.target.value)} placeholder="例：美容・ウェルネス" required />
              </div>
              <div className="field full">
                <label>サービス・商品の説明<span className="req">*</span></label>
                <textarea value={services} onChange={e => setServices(e.target.value)} placeholder="例：全身もみほぐし・アロマトリートメント。1回3500円〜、完全予約制。" required />
              </div>
              <div className="field full">
                <label>ブランドトーン<span className="req">*</span></label>
                <input type="text" value={brandTone} onChange={e => setBrandTone(e.target.value)} placeholder="例：穏やかで上品、でも親しみやすい。癒しと丁寧さを大切にしている" required />
              </div>
            </div>
          </div>

          <div className="card">
            <h2>🎯 ターゲット情報</h2>
            <div className="form-grid">
              <div className="field">
                <label>ターゲット年齢層<span className="req">*</span></label>
                <input type="text" value={ageRange} onChange={e => setAgeRange(e.target.value)} placeholder="例：20〜40代" required />
              </div>
              <div className="field">
                <label>性別</label>
                <input type="text" value={gender} onChange={e => setGender(e.target.value)} placeholder="例：女性メイン（男性も歓迎）" />
              </div>
              <div className="field full">
                <label>ターゲットの興味・関心<span className="req">*</span></label>
                <input type="text" value={interests} onChange={e => setInterests(e.target.value)} placeholder="カンマ区切り 例：美容, セルフケア, リラックス, 健康" required />
              </div>
            </div>
          </div>

          <div className="card">
            <h2>📣 目標・参考情報</h2>
            <div className="form-grid">
              <div className="field full">
                <label>TikTokでの目標<span className="req">*</span></label>
                <div className="checkboxes">
                  {[
                    ['brand_awareness', 'ブランド認知向上'],
                    ['followers',       'フォロワー獲得'],
                    ['lead_generation', 'リード獲得（予約・問い合わせ）'],
                    ['recruitment',     '採用'],
                  ].map(([val, label]) => (
                    <label key={val} className="checkbox-label">
                      <input type="checkbox" checked={goals.includes(val)} onChange={() => toggleGoal(val)} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field full">
                <label>参考TikTokアカウント（任意）</label>
                <input type="text" value={refAccounts} onChange={e => setRefAccounts(e.target.value)} placeholder="カンマ区切り 例：@account1, @account2" />
              </div>
              <div className="field full">
                <label>補足情報（任意）</label>
                <textarea value={additionalInfo} onChange={e => setAdditionalInfo(e.target.value)} placeholder="例：スタッフが若い女性中心で、SNS発信が得意。予約はLINEで受付中。" />
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={loadSample}>
              📂 サンプルを読み込む
            </button>
            <button type="submit" className="btn btn-primary" disabled={goals.length === 0}>
              🚀 企画を生成する
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
