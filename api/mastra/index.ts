// mastra/index.ts
// Mastraインスタンス - ワークスペース単位のManaエージェント

import { Mastra } from '@mastra/core';
import { createWorkspaceManaAgent } from './agents/workspace-mana-agent.js';
import { createMeetingAgent } from './agents/sub-agents/meeting-agent.js';
import { createTaskAgent } from './agents/sub-agents/task-agent.js';
import {
  workspaceConfigs,
  getWorkspaceByTeamId,
  getWorkspaceById,
  canAccessProject,
  canAccessPath,
  type WorkspaceConfig,
} from './config/workspaces.js';

// ワークスペース単位のManaエージェントを生成
const workspaceManaArray = workspaceConfigs.map(config => ({
  id: `${config.id}Mana`,
  agent: createWorkspaceManaAgent(config),
}));

// エージェントをオブジェクトに変換
const workspaceManas: Record<string, ReturnType<typeof createWorkspaceManaAgent>> = {};
for (const mana of workspaceManaArray) {
  workspaceManas[mana.id] = mana.agent;
}

// サブエージェント（会議・タスク用、共通）
const meetingAgent = createMeetingAgent();
const taskAgent = createTaskAgent();

// 全エージェントを結合
const allAgents = {
  meetingAgent,
  taskAgent,
  ...workspaceManas,
};

// Mastraインスタンス
export const mastra = new Mastra({
  agents: allAgents,
});

// エージェント取得ヘルパー（型安全でない動的取得用）
export function getAgent(agentId: string) {
  return (allAgents as Record<string, any>)[agentId];
}

// Slack Team IDからManaエージェントを取得
export function getManaByTeamId(teamId: string) {
  const workspace = getWorkspaceByTeamId(teamId);
  if (!workspace) return null;

  const manaId = `${workspace.id}Mana`;
  return {
    agent: getAgent(manaId),
    workspace,
  };
}

// ワークスペースIDからManaエージェントを取得
export function getManaByWorkspaceId(workspaceId: string) {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) return null;

  const manaId = `${workspace.id}Mana`;
  return {
    agent: getAgent(manaId),
    workspace,
  };
}

// エクスポート
export {
  workspaceConfigs,
  getWorkspaceByTeamId,
  getWorkspaceById,
  canAccessProject,
  canAccessPath,
  createWorkspaceManaAgent,
  createMeetingAgent,
  createTaskAgent,
  allAgents,
};

// Manaエージェントの一覧を取得
export function getManaIds(): string[] {
  return workspaceConfigs.map(config => `${config.id}Mana`);
}

console.log(
  `Mastra initialized. Registered agents: ${Object.keys(allAgents).join(', ')}`
);
