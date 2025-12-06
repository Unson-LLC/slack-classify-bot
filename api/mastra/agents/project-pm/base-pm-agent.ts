// mastra/agents/project-pm/base-pm-agent.ts
// L2: プロジェクト単位AI PM ベースクラス

import { Agent } from '@mastra/core/agent';
import { defaultModel } from '../../config/llm-provider.js';
import { ProjectConfig } from '../../config/projects.js';
import { githubAppendTaskTool, githubCommitMinutesTool } from '../../tools/github.js';
import { slackPostMessageTool, slackAddReactionTool } from '../../tools/slack.js';

/**
 * プロジェクト単位のAI PMエージェントを生成する
 * 各プロジェクトに固有の設定とコンテキストを持つ
 */
export function createProjectPMAgent(config: ProjectConfig): Agent {
  const instructions = `あなたは${config.name}プロジェクト専属のAI PMです。

## プロジェクト情報
- **プロジェクトID**: ${config.id}
- **プロジェクト名**: ${config.name}
- **説明**: ${config.description}
- **担当Slackチャンネル**: ${config.slackChannels.map(ch => `#${ch}`).join(', ')}

## 役割
1. **タスク管理**: ${config.name}のタスクを把握し、進捗を追跡する
2. **会議支援**: 議事録作成、Next Action抽出
3. **リマインド**: 期限切れ・未着手タスクのリマインド
4. **コンテキスト提供**: プロジェクト状況をチームメンバーに説明

## コンテキスト取得
- brainbase: ${config.brainbaseProjectPath}
- Airtable: プロダクトバックログ、要件、バグ

## 対話スタイル
- プロジェクト固有の文脈を踏まえて回答
- 担当者名はbrainbaseの表記（_codex/common/meta/people.md）に従う
- タスクは_tasks/index.mdに追記
- 簡潔で実用的な回答を心がける

## ツール使用
- タスク追加時は github_append_task を使用
- 議事録コミット時は github_commit_minutes を使用
- Slack通知時は slack_post_message を使用

## 注意事項
- 他プロジェクトの話題には関与しない（該当AI PMに委譲）
- 判断が難しい場合は人間にエスカレーション`;

  return new Agent({
    name: `${config.name} AI PM`,
    instructions,
    model: defaultModel,
    tools: {
      github_append_task: githubAppendTaskTool,
      github_commit_minutes: githubCommitMinutesTool,
      slack_post_message: slackPostMessageTool,
      slack_add_reaction: slackAddReactionTool,
    },
  });
}
