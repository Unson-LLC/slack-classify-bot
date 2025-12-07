// mastra/config/workspaces.ts
// ワークスペース単位のManaエージェント設定
//
// 正本: _codex/common/meta/slack/workspaces.yml
// このファイルは正本と同期して管理
// ワークスペース設定（正本: _codex/common/meta/slack/workspaces.yml）
export const workspaceConfigs = [
    {
        id: 'unson',
        name: 'UNSON',
        slackTeamId: 'T07L8TY5AN8',
        org: '雲孫',
        description: '雲孫グループ共通ワークスペース',
        projects: [
            'proj_zeims',
            'proj_baao',
            'proj_senrigan',
            'proj_dialogai',
            'proj_ncom',
            'proj_notionconnect',
            'proj_emporio',
            'proj_toranomon',
            'proj_postio',
            'proj_mywa',
            'proj_unson-os',
            'proj_back-office',
        ],
        scope: {
            readablePaths: [
                '_codex/projects/',
                '_codex/common/meta/glossary.md',
                '_codex/common/meta/people.md',
                '_codex/orgs/unson.md',
                '_codex/orgs/baao.md',
            ],
        },
    },
    {
        id: 'salestailor',
        name: 'SalesTailor',
        slackTeamId: 'T08EUJKQY07',
        org: 'SalesTailor',
        description: 'SalesTailor専用ワークスペース',
        projects: ['proj_salestailor'],
        scope: {
            readablePaths: [
                '_codex/projects/salestailor/',
                '_codex/common/meta/glossary.md',
                '_codex/common/meta/people.md',
                '_codex/orgs/salestailor.md',
            ],
        },
    },
    {
        id: 'techknight',
        name: 'Tech Knight',
        slackTeamId: 'T07A9J3PEMB',
        org: 'TechKnight',
        description: 'Tech Knight専用ワークスペース',
        projects: ['proj_techknight', 'proj_aitle'],
        scope: {
            readablePaths: [
                '_codex/projects/tech-knight/',
                '_codex/projects/aitle/',
                '_codex/common/meta/glossary.md',
                '_codex/common/meta/people.md',
                '_codex/orgs/techknight.md',
            ],
        },
    },
];
// Slack Team IDからワークスペースを取得
export function getWorkspaceByTeamId(teamId) {
    return workspaceConfigs.find(w => w.slackTeamId === teamId);
}
// ワークスペースIDから設定を取得
export function getWorkspaceById(workspaceId) {
    return workspaceConfigs.find(w => w.id === workspaceId);
}
// アクセス権限チェック
export function canAccessPath(workspace, path) {
    return workspace.scope.readablePaths.some(allowed => path.startsWith(allowed));
}
// プロジェクトIDがワークスペースのスコープ内かチェック
export function canAccessProject(workspace, projectId) {
    // proj_xxx形式に正規化
    const normalizedId = projectId.startsWith('proj_') ? projectId : `proj_${projectId}`;
    return workspace.projects.includes(normalizedId);
}
// デフォルトワークスペース（unson）を取得
export function getDefaultWorkspace() {
    return workspaceConfigs.find(w => w.id === 'unson');
}
//# sourceMappingURL=workspaces.js.map