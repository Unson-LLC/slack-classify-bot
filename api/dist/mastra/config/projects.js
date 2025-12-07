// mastra/config/projects.ts
// プロジェクト設定 - AI PM生成用
// プロジェクト設定一覧
// 将来的にはbrainbase MCPから動的取得も検討
export const projectConfigs = [
    {
        id: 'salestailor',
        name: 'SalesTailor',
        description: 'AIセールスレター自動生成SaaS',
        airtableBaseId: process.env.AIRTABLE_BASE_SALESTAILOR,
        slackChannels: ['salestailor-dev', 'salestailor-general', 'salestailor-sales'],
        brainbaseProjectPath: '_codex/projects/salestailor/project.md',
    },
    {
        id: 'zeims',
        name: 'Zeims',
        description: 'AI採用管理システム',
        airtableBaseId: process.env.AIRTABLE_BASE_ZEIMS,
        slackChannels: ['zeims-dev', 'zeims-general'],
        brainbaseProjectPath: '_codex/projects/zeims/project.md',
    },
    {
        id: 'techknight',
        name: 'TechKnight',
        description: 'エンジニアリングサービス',
        airtableBaseId: process.env.AIRTABLE_BASE_TECHKNIGHT,
        slackChannels: ['techknight-dev', 'techknight-sales'],
        brainbaseProjectPath: '_codex/projects/tech-knight/project.md',
    },
    {
        id: 'dialogai',
        name: 'DialogAI',
        description: 'AI会議ファシリテーション',
        airtableBaseId: process.env.AIRTABLE_BASE_DIALOGAI,
        slackChannels: ['dialogai-dev'],
        brainbaseProjectPath: '_codex/projects/dialog-ai/project.md',
    },
    {
        id: 'aitle',
        name: 'Aitle',
        description: 'AIタイトル生成サービス',
        airtableBaseId: process.env.AIRTABLE_BASE_AITLE,
        slackChannels: ['aitle-dev'],
        brainbaseProjectPath: '_codex/projects/aitle/project.md',
    },
];
// チャンネル名からプロジェクトを逆引き
export function getProjectByChannel(channelName) {
    return projectConfigs.find(p => p.slackChannels.some(ch => channelName.includes(ch) || ch.includes(channelName)));
}
// プロジェクトIDからプロジェクトを取得
export function getProjectById(projectId) {
    return projectConfigs.find(p => p.id === projectId);
}
//# sourceMappingURL=projects.js.map