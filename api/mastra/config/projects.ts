// mastra/config/projects.ts
// プロジェクト設定 - AI PM生成用 & Airtable連携

export interface AirtableConfig {
  baseId: string;
  productFeaturesTableId: string;
  requirementsTableId: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  description: string;
  airtable?: AirtableConfig;
  // チャンネル名パターン（部分一致）
  channelPatterns: string[];
  brainbaseProjectPath: string;
}

// 共通テーブルID（全プロジェクトで同じ構造を使用）
const COMMON_TABLE_IDS = {
  productFeaturesTableId: 'tblRBCgdT42VKx3eJ',
  requirementsTableId: 'tblgtuQ55xeeAXM0S',
};

/**
 * プロジェクト設定一覧
 * Airtable Base IDは中央Airtable（app9oeZUNRWZyaSdb）のproject_idテーブルから取得
 */
export const projectConfigs: ProjectConfig[] = [
  {
    id: 'zeims',
    name: 'Zeims',
    description: 'AI採用管理システム',
    airtable: {
      baseId: 'appg1DeWomuFuYnri',
      ...COMMON_TABLE_IDS,
    },
    channelPatterns: ['zeims', 'ゼイムス'],
    brainbaseProjectPath: '_codex/projects/zeims/project.md',
  },
  {
    id: 'salestailor',
    name: 'SalesTailor',
    description: 'AIセールスレター自動生成SaaS',
    airtable: {
      baseId: 'app8uhkD8PcnxPvVx',
      ...COMMON_TABLE_IDS,
    },
    channelPatterns: ['salestailor', 'セールステイラー'],
    brainbaseProjectPath: '_codex/projects/salestailor/project.md',
  },
  {
    id: 'aitle',
    name: 'Aitle',
    description: 'AIタイトル生成サービス',
    airtable: {
      baseId: 'appvZv4ybVDsBXtvC',
      ...COMMON_TABLE_IDS,
    },
    channelPatterns: ['aitle', 'アイトル'],
    brainbaseProjectPath: '_codex/projects/aitle/project.md',
  },
  {
    id: 'senrigan',
    name: 'Senrigan',
    description: '千里眼プロジェクト',
    airtable: {
      baseId: 'appDd7TdJf1t23PCm',
      ...COMMON_TABLE_IDS,
    },
    channelPatterns: ['senrigan', '千里眼'],
    brainbaseProjectPath: '_codex/projects/senrigan/project.md',
  },
  {
    id: 'mywa',
    name: 'Mywa',
    description: 'Mywaプロジェクト',
    airtable: {
      baseId: 'appJeMbMQcz507E9g',
      ...COMMON_TABLE_IDS,
    },
    channelPatterns: ['mywa', 'マイワ'],
    brainbaseProjectPath: '_codex/projects/mywa/project.md',
  },
  // Airtableなしのプロジェクト
  {
    id: 'techknight',
    name: 'TechKnight',
    description: 'エンジニアリングサービス',
    channelPatterns: ['techknight', 'tech-knight', 'テックナイト'],
    brainbaseProjectPath: '_codex/projects/tech-knight/project.md',
  },
  {
    id: 'dialogai',
    name: 'DialogAI',
    description: 'AI会議ファシリテーション',
    channelPatterns: ['dialogai', 'ダイアログ'],
    brainbaseProjectPath: '_codex/projects/dialog-ai/project.md',
  },
  {
    id: 'unson',
    name: 'UNSON',
    description: 'UNSON株式会社',
    channelPatterns: ['unson', 'アンソン'],
    brainbaseProjectPath: '_codex/projects/unson/project.md',
  },
  {
    id: 'baao',
    name: 'BAAO',
    description: 'BAAO事業',
    channelPatterns: ['baao', 'バーオ'],
    brainbaseProjectPath: '_codex/projects/baao/project.md',
  },
];

/**
 * チャンネル名からプロジェクトを逆引き
 */
export function getProjectByChannel(channelName: string): ProjectConfig | undefined {
  const lowerName = channelName.toLowerCase();
  return projectConfigs.find(p =>
    p.channelPatterns.some(pattern => lowerName.includes(pattern.toLowerCase()))
  );
}

/**
 * プロジェクトIDからプロジェクトを取得
 */
export function getProjectById(projectId: string): ProjectConfig | undefined {
  return projectConfigs.find(p => p.id === projectId);
}

/**
 * チャンネル名からAirtable設定を取得
 */
export function getAirtableConfigByChannel(channelName: string): AirtableConfig | undefined {
  const project = getProjectByChannel(channelName);
  return project?.airtable;
}
