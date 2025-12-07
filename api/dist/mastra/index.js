// mastra/index.ts
// Mastraインスタンス - L1/L2層のエントリーポイント
import { Mastra } from '@mastra/core';
import { createProjectPMAgent } from './agents/project-pm/base-pm-agent.js';
import { createMeetingAgent } from './agents/sub-agents/meeting-agent.js';
import { createTaskAgent } from './agents/sub-agents/task-agent.js';
import { projectConfigs, getProjectByChannel, getProjectById } from './config/projects.js';
// L2: プロジェクト単位のAI PMを動的生成
const projectPMsArray = projectConfigs.map(config => ({
    id: `${config.id}PM`,
    agent: createProjectPMAgent(config),
}));
// エージェントをオブジェクトに変換
const projectPMs = {};
for (const pm of projectPMsArray) {
    projectPMs[pm.id] = pm.agent;
}
// サブエージェント
const meetingAgent = createMeetingAgent();
const taskAgent = createTaskAgent();
// 全エージェントを結合
const allAgents = {
    meetingAgent,
    taskAgent,
    ...projectPMs,
};
// Mastraインスタンス
export const mastra = new Mastra({
    agents: allAgents,
});
// エージェント取得ヘルパー（型安全でない動的取得用）
export function getAgent(agentId) {
    return allAgents[agentId];
}
// エクスポート
export { projectConfigs, getProjectByChannel, getProjectById, createProjectPMAgent, createMeetingAgent, createTaskAgent, allAgents, };
// プロジェクトPMの一覧を取得
export function getProjectPMIds() {
    return projectConfigs.map(config => `${config.id}PM`);
}
// チャンネル名から該当するAI PMを取得
export function getProjectPMByChannel(channelName) {
    const project = getProjectByChannel(channelName);
    if (!project)
        return null;
    const pmId = `${project.id}PM`;
    return getAgent(pmId);
}
console.log(`Mastra initialized. Registered agents: ${Object.keys(allAgents).join(', ')}`);
//# sourceMappingURL=index.js.map