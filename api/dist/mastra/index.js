"use strict";
// mastra/index.ts
// Mastraインスタンス - L1/L2層のエントリーポイント
Object.defineProperty(exports, "__esModule", { value: true });
exports.allAgents = exports.createTaskAgent = exports.createMeetingAgent = exports.createProjectPMAgent = exports.getProjectById = exports.getProjectByChannel = exports.projectConfigs = exports.mastra = void 0;
exports.getAgent = getAgent;
exports.getProjectPMIds = getProjectPMIds;
exports.getProjectPMByChannel = getProjectPMByChannel;
const core_1 = require("@mastra/core");
const base_pm_agent_js_1 = require("./agents/project-pm/base-pm-agent.js");
Object.defineProperty(exports, "createProjectPMAgent", { enumerable: true, get: function () { return base_pm_agent_js_1.createProjectPMAgent; } });
const meeting_agent_js_1 = require("./agents/sub-agents/meeting-agent.js");
Object.defineProperty(exports, "createMeetingAgent", { enumerable: true, get: function () { return meeting_agent_js_1.createMeetingAgent; } });
const task_agent_js_1 = require("./agents/sub-agents/task-agent.js");
Object.defineProperty(exports, "createTaskAgent", { enumerable: true, get: function () { return task_agent_js_1.createTaskAgent; } });
const projects_js_1 = require("./config/projects.js");
Object.defineProperty(exports, "projectConfigs", { enumerable: true, get: function () { return projects_js_1.projectConfigs; } });
Object.defineProperty(exports, "getProjectByChannel", { enumerable: true, get: function () { return projects_js_1.getProjectByChannel; } });
Object.defineProperty(exports, "getProjectById", { enumerable: true, get: function () { return projects_js_1.getProjectById; } });
// L2: プロジェクト単位のAI PMを動的生成
const projectPMsArray = projects_js_1.projectConfigs.map(config => ({
    id: `${config.id}PM`,
    agent: (0, base_pm_agent_js_1.createProjectPMAgent)(config),
}));
// エージェントをオブジェクトに変換
const projectPMs = {};
for (const pm of projectPMsArray) {
    projectPMs[pm.id] = pm.agent;
}
// サブエージェント
const meetingAgent = (0, meeting_agent_js_1.createMeetingAgent)();
const taskAgent = (0, task_agent_js_1.createTaskAgent)();
// 全エージェントを結合
const allAgents = {
    meetingAgent,
    taskAgent,
    ...projectPMs,
};
exports.allAgents = allAgents;
// Mastraインスタンス
exports.mastra = new core_1.Mastra({
    agents: allAgents,
});
// エージェント取得ヘルパー（型安全でない動的取得用）
function getAgent(agentId) {
    return allAgents[agentId];
}
// プロジェクトPMの一覧を取得
function getProjectPMIds() {
    return projects_js_1.projectConfigs.map(config => `${config.id}PM`);
}
// チャンネル名から該当するAI PMを取得
function getProjectPMByChannel(channelName) {
    const project = (0, projects_js_1.getProjectByChannel)(channelName);
    if (!project)
        return null;
    const pmId = `${project.id}PM`;
    return getAgent(pmId);
}
console.log(`Mastra initialized. Registered agents: ${Object.keys(allAgents).join(', ')}`);
//# sourceMappingURL=index.js.map