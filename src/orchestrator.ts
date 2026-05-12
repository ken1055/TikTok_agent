import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import ora from 'ora';
import { ClientInfo, PlanningOutput } from './types';
import { runResearcher } from './agents/researcher';
import { runStrategist } from './agents/strategist';
import { runPlanner } from './agents/planner';
import { runReviewer } from './agents/reviewer';

export type RefineProgressEvent =
  | { phase: 'planning'; status: 'start' | 'done'; count?: number }
  | { phase: 'review';   status: 'start' | 'done'; retry?: number };

export type ProgressEvent =
  | { phase: 'research';  status: 'start' | 'done' }
  | { phase: 'strategy';  status: 'start' | 'done' }
  | { phase: 'planning';  status: 'start' | 'done'; count?: number }
  | { phase: 'review';    status: 'start' | 'done'; retry?: number };

export type ProgressCallback = (event: ProgressEvent) => void;

function log(role: string, message: string, color: chalk.Chalk) {
  console.log(color(`[${role}] `) + message);
}

export async function orchestrate(
  clientInfo: ClientInfo,
  onProgress?: ProgressCallback,
): Promise<PlanningOutput> {
  const client = new Anthropic();
  const silent = !!onProgress;

  if (!silent) {
    console.log('\n' + chalk.bold('━'.repeat(60)));
    console.log(chalk.bold.cyan('  TikTok企画生成 エージェントチーム起動'));
    console.log(chalk.bold('━'.repeat(60)));
    console.log(chalk.gray(`  クライアント: ${clientInfo.companyName}`));
    console.log(chalk.bold('━'.repeat(60)) + '\n');
    log('リーダー', 'フェーズ1: TikTokトレンドをリサーチします', chalk.yellow);
  }

  onProgress?.({ phase: 'research', status: 'start' });
  const researchSpinner = silent ? null : ora({ text: chalk.blue('[調査Agent] TikTokトレンドをリサーチ中...'), color: 'blue' }).start();

  const trendReport = await runResearcher(client, clientInfo);
  researchSpinner?.succeed(chalk.blue('[調査Agent] トレンドリサーチ完了'));
  onProgress?.({ phase: 'research', status: 'done' });

  if (!silent) {
    console.log('');
    log('リーダー', 'フェーズ1b: トレンドデータをもとにコンテンツ戦略を策定します', chalk.yellow);
  }

  onProgress?.({ phase: 'strategy', status: 'start' });
  const strategySpinner = silent ? null : ora({ text: chalk.magenta('[戦略Agent] コンテンツ戦略を策定中...'), color: 'magenta' }).start();

  const contentStrategy = await runStrategist(client, clientInfo, trendReport);
  strategySpinner?.succeed(chalk.magenta('[戦略Agent] コンテンツ戦略完了'));
  onProgress?.({ phase: 'strategy', status: 'done' });

  if (!silent) {
    console.log('');
    log('リーダー', 'フェーズ2: 企画生成エージェントを起動します', chalk.yellow);
  }

  onProgress?.({ phase: 'planning', status: 'start' });
  const plannerSpinner = silent ? null : ora({ text: chalk.green('[企画Agent] 動画企画を生成中...（8〜10本）'), color: 'green' }).start();

  let videoplans = await runPlanner(client, clientInfo, trendReport, contentStrategy);
  for (let retry = 1; retry <= 2 && videoplans.length === 0; retry++) {
    if (plannerSpinner) plannerSpinner.text = chalk.green(`[企画Agent] 企画生成リトライ中... (${retry}/2)`);
    videoplans = await runPlanner(client, clientInfo, trendReport, contentStrategy);
  }

  plannerSpinner?.succeed(chalk.green(`[企画Agent] ${videoplans.length}本の企画を生成`));
  onProgress?.({ phase: 'planning', status: 'done', count: videoplans.length });

  if (!silent) {
    console.log('');
    log('リーダー', 'フェーズ3: レビューエージェントが品質チェックを実施します', chalk.yellow);
  }

  onProgress?.({ phase: 'review', status: 'start' });
  const reviewerSpinner = silent ? null : ora({ text: chalk.red('[レビューAgent] 企画を審査・スコアリング中...'), color: 'red' }).start();

  let reviewedPlans = await runReviewer(client, clientInfo, contentStrategy, videoplans);

  for (let retry = 1; retry <= 2 && reviewedPlans.every(p => p.score === 0); retry++) {
    if (reviewerSpinner) reviewerSpinner.text = chalk.red(`[レビューAgent] スコア再審査中... (${retry}/2)`);
    onProgress?.({ phase: 'review', status: 'start', retry });
    reviewedPlans = await runReviewer(client, clientInfo, contentStrategy, videoplans);
  }

  reviewerSpinner?.succeed(chalk.red('[レビューAgent] 審査完了'));
  onProgress?.({ phase: 'review', status: 'done' });

  if (reviewedPlans.length === 0) {
    if (!silent) console.log(chalk.yellow('  ⚠️  レビュー結果が空のため、企画をそのまま出力します'));
    reviewedPlans = videoplans.map(p => ({ ...p, score: 0, strengths: [], improvements: '' }));
  }

  reviewedPlans.sort((a, b) => b.score - a.score);

  const output: PlanningOutput = {
    clientInfo,
    generatedAt: new Date().toISOString(),
    trendReport,
    contentStrategy,
    videoplans: reviewedPlans,
  };

  if (!silent) {
    console.log('\n' + chalk.bold('━'.repeat(60)));
    log('リーダー', `企画生成完了！${reviewedPlans.length}本の企画を出力します`, chalk.yellow.bold);
    const avgScore = reviewedPlans.reduce((sum, p) => sum + p.score, 0) / reviewedPlans.length;
    console.log(chalk.gray(`  平均バズスコア: ${avgScore.toFixed(1)} / 10`));
    console.log(chalk.gray(`  最高スコア企画: ${reviewedPlans[0]?.title}`));
    console.log(chalk.bold('━'.repeat(60)) + '\n');
  }

  return output;
}

// プランだけ再生成（リサーチ・戦略はキャッシュを使用）
export async function refine(
  existingOutput: PlanningOutput,
  refinementRequest: string,
  onProgress?: (event: RefineProgressEvent) => void,
): Promise<PlanningOutput> {
  const client = new Anthropic();
  const { clientInfo, trendReport, contentStrategy } = existingOutput;

  onProgress?.({ phase: 'planning', status: 'start' });
  let videoplans = await runPlanner(client, clientInfo, trendReport, contentStrategy, refinementRequest);
  for (let retry = 1; retry <= 2 && videoplans.length === 0; retry++) {
    videoplans = await runPlanner(client, clientInfo, trendReport, contentStrategy, refinementRequest);
  }
  onProgress?.({ phase: 'planning', status: 'done', count: videoplans.length });

  onProgress?.({ phase: 'review', status: 'start' });
  let reviewedPlans = await runReviewer(client, clientInfo, contentStrategy, videoplans);
  for (let retry = 1; retry <= 2 && reviewedPlans.every(p => p.score === 0); retry++) {
    onProgress?.({ phase: 'review', status: 'start', retry });
    reviewedPlans = await runReviewer(client, clientInfo, contentStrategy, videoplans);
  }
  if (reviewedPlans.length === 0) {
    reviewedPlans = videoplans.map(p => ({ ...p, score: 0, strengths: [], improvements: '' }));
  }
  reviewedPlans.sort((a, b) => b.score - a.score);
  onProgress?.({ phase: 'review', status: 'done' });

  return {
    ...existingOutput,
    generatedAt: new Date().toISOString(),
    videoplans: reviewedPlans,
  };
}
