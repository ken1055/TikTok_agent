export interface ClientInfo {
  companyName: string;
  industry: string;
  services: string;
  targetAudience: {
    ageRange: string;
    gender: string;
    interests: string[];
  };
  goals: ('brand_awareness' | 'followers' | 'lead_generation' | 'recruitment')[];
  brandTone: string;
  referenceAccounts?: string[];
  additionalInfo?: string;
}

// --- 調査エージェント出力 ---
export interface TrendReport {
  popularFormats: string[];
  trendingTopics: string[];
  effectiveHooks: string[];
  competitorInsights: string;
}

// --- 戦略エージェント出力 ---
export interface ContentPillar {
  name: string;
  description: string;
  contentTypes: string[];
}

export interface ContentStrategy {
  contentPillars: ContentPillar[];
  targetPersona: string;
  styleGuidelines: string;
  postingFrequency: string;
}

// --- 企画エージェント出力 ---
export interface VideoStructure {
  opening: string;
  bodyPoints: string[];
  closing: string;
}

export interface VideoPlan {
  id: number;
  title: string;
  hook: string;
  structure: VideoStructure;
  hashtags: string[];
  bgmSuggestion: string;
  editingStyle: string;
  contentPillar: string;
  estimatedDuration: string;
}

// --- レビューエージェント出力 ---
export interface ReviewedPlan extends VideoPlan {
  score: number;
  strengths: string[];
  improvements: string;
}

// --- 最終出力 ---
export interface PlanningOutput {
  clientInfo: ClientInfo;
  generatedAt: string;
  trendReport: TrendReport;
  contentStrategy: ContentStrategy;
  videoplans: ReviewedPlan[];
}

// --- 台本エージェント出力 ---
export interface ScriptScene {
  timeCode: string;
  sceneType: 'hook' | 'body' | 'closing';
  narration: string;
  action: string;
  caption: string;
}

export interface VideoScript {
  planId: number;
  planTitle: string;
  totalDuration: string;
  scenes: ScriptScene[];
  productionNotes: string;
}
