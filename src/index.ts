import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { ClientInfo, PlanningOutput } from './types';
import { orchestrate } from './orchestrator';

dotenv.config();

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function promptClientInfo(): Promise<ClientInfo> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold.cyan('\n📋 クライアント情報を入力してください\n'));

  const companyName = await question(rl, chalk.bold('会社名: '));
  const industry = await question(rl, chalk.bold('業界（例: 美容、飲食、IT、不動産）: '));
  const services = await question(rl, chalk.bold('サービス・商品の説明: '));
  const ageRange = await question(rl, chalk.bold('ターゲット年齢層（例: 20〜30代）: '));
  const gender = await question(rl, chalk.bold('ターゲット性別（例: 女性メイン、全性別）: '));
  const interestsRaw = await question(rl, chalk.bold('ターゲットの興味・関心（カンマ区切り）: '));
  const goalsRaw = await question(rl, chalk.bold('目的（brand_awareness/followers/lead_generation/recruitment、カンマ区切り）: '));
  const brandTone = await question(rl, chalk.bold('ブランドトーン（例: 親しみやすい、プロフェッショナル、ポップ）: '));
  const refAccounts = await question(rl, chalk.bold('参考TikTokアカウント（任意、カンマ区切り）: '));
  const additionalInfo = await question(rl, chalk.bold('補足情報（任意）: '));

  rl.close();

  const goals = goalsRaw
    .split(',')
    .map(g => g.trim())
    .filter(g => ['brand_awareness', 'followers', 'lead_generation', 'recruitment'].includes(g)) as ClientInfo['goals'];

  return {
    companyName: companyName.trim(),
    industry: industry.trim(),
    services: services.trim(),
    targetAudience: {
      ageRange: ageRange.trim(),
      gender: gender.trim(),
      interests: interestsRaw.split(',').map(i => i.trim()).filter(Boolean),
    },
    goals: goals.length > 0 ? goals : ['brand_awareness'],
    brandTone: brandTone.trim(),
    referenceAccounts: refAccounts ? refAccounts.split(',').map(a => a.trim()).filter(Boolean) : undefined,
    additionalInfo: additionalInfo.trim() || undefined,
  };
}

function formatOutput(output: PlanningOutput): string {
  const lines: string[] = [];
  const { clientInfo: ci, trendReport: tr, contentStrategy: cs, videoplans } = output;

  lines.push('='.repeat(60));
  lines.push(`TikTok動画企画書`);
  lines.push(`クライアント: ${ci.companyName}  生成日時: ${new Date(output.generatedAt).toLocaleString('ja-JP')}`);
  lines.push('='.repeat(60));

  lines.push('\n## トレンドリサーチ結果\n');
  lines.push('### 人気フォーマット');
  tr.popularFormats.forEach(f => lines.push(`  ・${f}`));
  lines.push('\n### トレンドトピック');
  tr.trendingTopics.forEach(t => lines.push(`  ・${t}`));
  lines.push('\n### 効果的なフック例');
  tr.effectiveHooks.forEach(h => lines.push(`  ・${h}`));
  lines.push('\n### 競合分析');
  lines.push(`  ${tr.competitorInsights}`);

  lines.push('\n' + '─'.repeat(60));
  lines.push('\n## コンテンツ戦略\n');
  lines.push('### ターゲットペルソナ');
  lines.push(`  ${cs.targetPersona}`);
  lines.push('\n### コンテンツの柱');
  cs.contentPillars.forEach(p => {
    lines.push(`\n  【${p.name}】`);
    lines.push(`  ${p.description}`);
    p.contentTypes.forEach(ct => lines.push(`    - ${ct}`));
  });
  lines.push('\n### スタイルガイドライン');
  lines.push(`  ${cs.styleGuidelines}`);
  lines.push('\n### 推奨投稿頻度');
  lines.push(`  ${cs.postingFrequency}`);

  lines.push('\n' + '─'.repeat(60));
  lines.push('\n## 動画企画（スコア順）\n');

  videoplans.forEach(plan => {
    lines.push(`${'─'.repeat(50)}`);
    lines.push(`企画 #${plan.id}  ★バズスコア: ${plan.score}/10`);
    lines.push(`タイトル: 【${plan.title}】`);
    lines.push(`コンテンツ柱: ${plan.contentPillar}  |  尺: ${plan.estimatedDuration}`);
    lines.push('');
    lines.push(`🎣 フック（冒頭）:`);
    lines.push(`  「${plan.hook}」`);
    lines.push('');
    lines.push(`📹 構成:`);
    lines.push(`  [冒頭] ${plan.structure.opening}`);
    plan.structure.bodyPoints.forEach((pt, i) =>
      lines.push(`  [本編${i + 1}] ${pt}`)
    );
    lines.push(`  [締め] ${plan.structure.closing}`);
    lines.push('');
    lines.push(`🎵 BGM: ${plan.bgmSuggestion}`);
    lines.push(`✂️  編集: ${plan.editingStyle}`);
    lines.push(`#️⃣  ハッシュタグ: ${plan.hashtags.join(' ')}`);
    lines.push('');
    lines.push(`💪 強み:`);
    plan.strengths.forEach(s => lines.push(`  ・${s}`));
    lines.push(`💡 改善提案: ${plan.improvements}`);
    lines.push('');
  });

  lines.push('='.repeat(60));
  return lines.join('\n');
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red('エラー: ANTHROPIC_API_KEY が設定されていません。'));
    console.error(chalk.gray('.env ファイルに ANTHROPIC_API_KEY=your_key を設定してください。'));
    process.exit(1);
  }

  // コマンドライン引数でJSONファイルを指定可能
  const jsonArg = process.argv[2];
  let clientInfo: ClientInfo;

  if (jsonArg && fs.existsSync(jsonArg)) {
    console.log(chalk.gray(`クライアント情報をファイルから読み込み: ${jsonArg}`));
    clientInfo = JSON.parse(fs.readFileSync(jsonArg, 'utf-8'));
  } else {
    clientInfo = await promptClientInfo();
  }

  try {
    const output = await orchestrate(clientInfo);

    // 出力ディレクトリの作成
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeCompanyName = clientInfo.companyName.replace(/[^\w　-鿿]/g, '_');

    // JSON保存
    const jsonPath = path.join(outputDir, `${safeCompanyName}_${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf-8');

    // テキスト保存
    const txtPath = path.join(outputDir, `${safeCompanyName}_${timestamp}.txt`);
    const formatted = formatOutput(output);
    fs.writeFileSync(txtPath, formatted, 'utf-8');

    // コンソール出力
    console.log(formatted);

    console.log(chalk.bold.green('\n✅ ファイルを保存しました:'));
    console.log(chalk.gray(`  JSON: ${jsonPath}`));
    console.log(chalk.gray(`  テキスト: ${txtPath}`));

  } catch (err) {
    console.error(chalk.red('\nエラーが発生しました:'), err);
    process.exit(1);
  }
}

main();
