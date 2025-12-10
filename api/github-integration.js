const axios = require('axios');
const { TaskIdGenerator } = require('./task-id-generator');
const { AirtableTaskSync } = require('./airtable-task-sync');

class GitHubIntegration {
  constructor(token = process.env.GITHUB_TOKEN, options = {}) {
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is not set');
    }
    this.token = token;
    this.baseUrl = 'https://api.github.com';

    // Task ID Generator（DynamoDB atomic counter）
    this.taskIdGenerator = options.taskIdGenerator || new TaskIdGenerator();

    // Airtable Sync（オプション: 無効化可能）
    this.airtableSync = options.disableAirtableSync ? null : (options.airtableSync || new AirtableTaskSync());
  }

  /**
   * 二層構造で会議記録をGitHubにコミット
   * - トランスクリプト（原本）: transcripts/YYYY-MM-DD_name.txt
   * - 議事録（AI処理済み）: minutes/YYYY-MM-DD_name.md
   *
   * @param {Object} params - コミットパラメータ
   * @param {string} params.owner - GitHubオーナー
   * @param {string} params.repo - リポジトリ名
   * @param {string} params.branch - ブランチ名
   * @param {string} params.pathPrefix - パスプレフィックス（例: meetings/2024/）
   * @param {string} params.dateStr - 日付文字列（YYYY-MM-DD）
   * @param {string} params.baseName - ベースファイル名（例: weekly-standup）
   * @param {string} params.transcript - トランスクリプト（原文）
   * @param {string} params.minutes - 議事録（AI生成）
   * @param {string} params.summary - 要約
   * @returns {Promise<Object>} - コミット結果
   */
  async commitMeetingRecords({
    owner,
    repo,
    branch = 'main',
    pathPrefix,
    dateStr,
    baseName,
    transcript,
    minutes,
    summary
  }) {
    const transcriptPath = `${pathPrefix}transcripts/${dateStr}_${baseName}.txt`;
    const minutesPath = `${pathPrefix}minutes/${dateStr}_${baseName}.md`;

    const transcriptRef = `../transcripts/${dateStr}_${baseName}.txt`;

    const minutesContent = this.formatMinutesContent({
      baseName,
      dateStr,
      summary,
      minutes,
      transcriptRef
    });

    const results = {
      transcript: null,
      minutes: null,
      errors: []
    };

    try {
      results.transcript = await this.createOrUpdateFile({
        owner,
        repo,
        branch,
        path: transcriptPath,
        content: transcript,
        message: `Add transcript: ${dateStr}_${baseName}`
      });
    } catch (error) {
      results.errors.push({ type: 'transcript', error: error.message });
    }

    try {
      results.minutes = await this.createOrUpdateFile({
        owner,
        repo,
        branch,
        path: minutesPath,
        content: minutesContent,
        message: `Add meeting minutes: ${dateStr}_${baseName}`
      });
    } catch (error) {
      results.errors.push({ type: 'minutes', error: error.message });
    }

    return {
      success: results.errors.length === 0,
      transcript: results.transcript,
      minutes: results.minutes,
      paths: {
        transcript: transcriptPath,
        minutes: minutesPath
      },
      errors: results.errors
    };
  }

  /**
   * 議事録コンテンツをフォーマット
   */
  formatMinutesContent({ baseName, dateStr, summary, minutes, transcriptRef }) {
    return `---
transcript_ref: ${transcriptRef}
date: ${dateStr}
---

# ${dateStr} ${baseName.replace(/-/g, ' ')}

## 要約

${summary || '要約なし'}

---

${minutes || '詳細議事録なし'}

---

*この議事録はAIにより自動生成されました*
`;
  }

  /**
   * GitHub APIでファイルを作成または更新
   */
  async createOrUpdateFile({ owner, repo, branch, path, content, message }) {
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    let sha = null;

    try {
      const getResponse = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        { headers }
      );
      sha = getResponse.data.sha;
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
    }

    const payload = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch
    };

    if (sha) {
      payload.sha = sha;
    }

    const response = await axios.put(
      `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}`,
      payload,
      { headers }
    );

    return {
      path,
      sha: response.data.content.sha,
      commitSha: response.data.commit.sha,
      commitUrl: response.data.commit.html_url,
      fileUrl: response.data.content.html_url
    };
  }

  /**
   * 単一ファイルをコミット（後方互換性のため）
   */
  async commitSingleFile({ owner, repo, branch, path, content, message }) {
    return this.createOrUpdateFile({ owner, repo, branch, path, content, message });
  }

  /**
   * ファイルの現在の内容を取得
   */
  async getFileContent({ owner, repo, branch, path }) {
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        { headers }
      );
      return {
        content: Buffer.from(response.data.content, 'base64').toString('utf-8'),
        sha: response.data.sha
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return { content: '', sha: null };
      }
      throw error;
    }
  }

  /**
   * タスクを_tasks/index.mdに追加
   * @param {Object} task - タスク情報
   * @param {string} task.title - タスクタイトル
   * @param {string} task.project_id - プロジェクトID
   * @param {string} task.priority - 優先度(high/medium/low)
   * @param {string|null} task.due - 期限(YYYY-MM-DD)
   * @param {string} task.context - コンテキスト/背景
   * @param {string} task.requester - 依頼者
   * @param {string} task.assignee_slack_id - 担当者のSlack ID
   * @param {string} slackLink - Slackメッセージへのリンク
   * @param {Object} slackContext - Slackコンテキスト情報（スレッドリマインド用）
   * @param {string} slackContext.channel_id - SlackチャンネルID
   * @param {string} slackContext.thread_ts - スレッドタイムスタンプ
   * @returns {Promise<Object>} - コミット結果
   */
  async appendTask(task, slackLink = '', slackContext = null) {
    const owner = 'sintariran';
    const repo = 'brainbase';
    const branch = 'main';
    const path = '_tasks/index.md';

    // 現在のファイル内容を取得
    const { content: currentContent, sha } = await this.getFileContent({ owner, repo, branch, path });

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // 新しいタスクID（T-YYMM-NNN形式）を生成
    let taskId;
    let sourceId;
    try {
      taskId = await this.taskIdGenerator.generateNextId(now);
      // 元のSlack IDはsource_idとして保持
      sourceId = `SLACK-${dateStr}-${now.getTime().toString(36).toUpperCase()}`;
    } catch (error) {
      // DynamoDBエラー時はフォールバックとして従来形式を使用
      console.warn('Failed to generate task ID from DynamoDB, using fallback:', error.message);
      taskId = `SLACK-${dateStr}-${now.getTime().toString(36).toUpperCase()}`;
      sourceId = taskId;
    }

    // 担当者を決定（assigneeがあれば使用、なければkeigo）
    const taskOwner = task.assignee || 'keigo';
    const ownerFormatted = taskOwner.replace(' ', '-').toLowerCase();

    // Slackコンテキストがある場合のみSlack関連フィールドを追加
    const hasSlackContext = slackContext && slackContext.channel_id && slackContext.thread_ts;
    const requesterField = task.requester ? `requester: ${task.requester.replace(/\s+/g, '-').toLowerCase()}\n` : '';
    const slackFields = hasSlackContext ? `source: slack
channel_id: ${slackContext.channel_id}
thread_ts: "${slackContext.thread_ts}"
created_at: "${now.toISOString()}"
owner_slack_id: ${task.assignee_slack_id || ''}
${requesterField}` : `created_at: "${now.toISOString()}"
${requesterField}`;

    // タスクをYAML形式でフォーマット（新フィールド追加）
    const taskEntry = `---
task_id: ${taskId}
source_id: ${sourceId}
title: ${task.title}
project_id: ${task.project_id || 'general'}
status: todo
owner: ${ownerFormatted}
priority: ${task.priority || 'medium'}
due: ${task.due || 'null'}
tags: [slack, auto-import]
links: []
${slackFields}---

- ${dateStr} Slackから自動取り込み: ${task.requester}から依頼
- 担当: ${taskOwner}
${task.context ? `- 背景: ${task.context}` : ''}
${slackLink ? `- Slack: ${slackLink}` : ''}

`;

    // ファイルの先頭に追加（新しいタスクが上に来る）
    const newContent = taskEntry + currentContent;

    // コミット
    const result = await this.createOrUpdateFile({
      owner,
      repo,
      branch,
      path,
      content: newContent,
      message: `feat: タスク追加 - ${task.title}`
    });

    // Airtableに同期（有効な場合）
    let airtableResult = null;
    if (this.airtableSync) {
      try {
        const taskData = {
          task_id: taskId,
          source_id: sourceId,
          title: task.title,
          project_id: task.project_id || 'general',
          status: 'todo',
          owner: ownerFormatted,
          priority: task.priority || 'medium',
          due: task.due || null
        };
        airtableResult = await this.airtableSync.syncTaskToAirtable(taskData);
      } catch (error) {
        console.warn('Failed to sync task to Airtable:', error.message);
        airtableResult = { success: false, error: error.message };
      }
    }

    return {
      success: true,
      taskId,
      sourceId,
      airtableResult,
      ...result
    };
  }

  /**
   * @k.satoへのメンションを_inbox/pending.mdに追記
   * Claude Codeが起動時に確認できるようにする
   * @param {Object} mention - メンション情報
   * @param {string} mention.channelName - チャンネル名
   * @param {string} mention.senderName - 送信者名
   * @param {string} mention.text - メッセージテキスト
   * @param {string} mention.timestamp - タイムスタンプ
   * @param {string} mention.slackLink - Slackへのリンク
   * @returns {Promise<Object>} - コミット結果
   */
  async appendToInbox(mention) {
    const owner = 'sintariran';
    const repo = 'brainbase';
    const branch = 'main';
    const path = '_inbox/pending.md';

    // 現在のファイル内容を取得（存在しない場合は空）
    const { content: currentContent, sha } = await this.getFileContent({ owner, repo, branch, path });

    // 日付と時刻をフォーマット
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });

    // メンションIDを生成
    const mentionId = `INBOX-${dateStr}-${now.getTime().toString(36).toUpperCase()}`;

    // メンションエントリをフォーマット
    const mentionEntry = `---
id: ${mentionId}
channel: ${mention.channelName}
sender: ${mention.senderName}
timestamp: ${mention.timestamp}
status: pending
---

### ${timeStr} | #${mention.channelName} | ${mention.senderName}

${mention.text}

[Slack](${mention.slackLink})

`;

    // ファイルの先頭に追加（新しいメンションが上に来る）
    let newContent;
    if (!currentContent || currentContent.trim() === '') {
      // ファイルが空の場合はヘッダーを追加
      newContent = `# Pending Inbox Items

<!-- AI PMが自動更新。Claude Code起動時に確認・対応を提案 -->

${mentionEntry}`;
    } else {
      // 既存のヘッダーの後に追加
      const headerEnd = currentContent.indexOf('\n\n---');
      if (headerEnd > 0) {
        // ヘッダーがある場合はその後に挿入
        const header = currentContent.substring(0, headerEnd + 2);
        const rest = currentContent.substring(headerEnd + 2);
        newContent = header + mentionEntry + rest;
      } else {
        // ヘッダーがない場合は先頭に追加
        newContent = mentionEntry + currentContent;
      }
    }

    // コミット
    const result = await this.createOrUpdateFile({
      owner,
      repo,
      branch,
      path,
      content: newContent,
      message: `inbox: @k.sato mention from #${mention.channelName}`
    });

    return {
      success: true,
      mentionId,
      ...result
    };
  }

  // --- Personal Tasks Methods ---

  /**
   * ユーザーIDから個人タスクファイルのパスを生成
   * @param {string} userId - ユーザーID（例: k.sato）
   * @returns {string} - 個人タスクファイルのパス
   */
  getPersonalTasksPath(userId) {
    if (!userId) {
      throw new Error('userId is required');
    }
    return `_tasks/personal/${userId}.md`;
  }

  /**
   * タスクが個人タスクかどうかを判定
   * @param {Object} task - タスク情報
   * @returns {boolean} - 個人タスクならtrue
   */
  isPersonalTask(task) {
    if (task.project_id === 'personal') {
      return true;
    }
    if (task.tags && Array.isArray(task.tags) && task.tags.includes('personal')) {
      return true;
    }
    return false;
  }

  /**
   * 個人タスクを_tasks/personal/{userId}.mdに追加
   * @param {string} userId - ユーザーID
   * @param {Object} task - タスク情報
   * @param {string} task.title - タスクタイトル
   * @param {string} task.priority - 優先度(high/medium/low)
   * @param {string|null} task.due - 期限(YYYY-MM-DD)
   * @param {string} task.context - コンテキスト/背景
   * @returns {Promise<Object>} - コミット結果
   */
  async appendPersonalTask(userId, task) {
    const owner = 'sintariran';
    const repo = 'brainbase';
    const branch = 'main';
    const path = this.getPersonalTasksPath(userId);

    // 現在のファイル内容を取得
    const { content: currentContent, sha } = await this.getFileContent({ owner, repo, branch, path });

    // タスクIDを生成
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const taskId = `PERSONAL-${dateStr}-${now.getTime().toString(36).toUpperCase()}`;

    // タスクをYAML形式でフォーマット
    const taskEntry = `---
id: ${taskId}
title: ${task.title}
project_id: personal
status: todo
owner: ${userId}
priority: ${task.priority || 'medium'}
due: ${task.due || 'null'}
tags: [personal]
links: []
created_at: "${now.toISOString()}"
---

- ${dateStr} 個人タスク追加
${task.context ? `- 背景: ${task.context}` : ''}

`;

    let newContent;
    if (!currentContent || currentContent.trim() === '') {
      // ファイルが存在しない場合はテンプレートから作成
      newContent = `# ${userId} 個人タスク

> このファイルは個人タスク専用です。Airtableには同期されません。
> チームと共有が必要なタスクは \`_tasks/index.md\` に追加してください。

---

## アクティブタスク

${taskEntry}---

## 完了済みタスク

`;
    } else {
      // 「## アクティブタスク」セクションの後に追加
      const activeTasksMarker = '## アクティブタスク';
      const activeTasksIndex = currentContent.indexOf(activeTasksMarker);

      if (activeTasksIndex >= 0) {
        // マーカーの後の改行を探す
        const insertPosition = currentContent.indexOf('\n', activeTasksIndex) + 1;
        // 次の行も改行なら、その後に挿入
        const nextNewline = currentContent.indexOf('\n', insertPosition);
        const finalPosition = nextNewline >= 0 ? nextNewline + 1 : insertPosition;

        newContent = currentContent.slice(0, finalPosition) + '\n' + taskEntry + currentContent.slice(finalPosition);
      } else {
        // マーカーがない場合は先頭に追加
        newContent = taskEntry + currentContent;
      }
    }

    // コミット
    const result = await this.createOrUpdateFile({
      owner,
      repo,
      branch,
      path,
      content: newContent,
      message: `personal: タスク追加 - ${task.title}`
    });

    return {
      success: true,
      taskId,
      ...result
    };
  }

  /**
   * _inbox/pending.mdから処理済みアイテムをアーカイブ
   * @param {string} mentionId - アーカイブするメンションID
   * @returns {Promise<Object>} - コミット結果
   */
  async archiveInboxItem(mentionId) {
    const owner = 'sintariran';
    const repo = 'brainbase';
    const branch = 'main';
    const pendingPath = '_inbox/pending.md';
    const archivePath = '_inbox/archive.md';

    // pending.mdの内容を取得
    const { content: pendingContent } = await this.getFileContent({ owner, repo, branch, path: pendingPath });

    if (!pendingContent) {
      return { success: false, error: 'Pending file not found' };
    }

    // メンションIDに該当するブロックを抽出
    const blocks = pendingContent.split(/^---$/m);
    let archivedBlock = null;
    const remainingBlocks = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.includes(`id: ${mentionId}`)) {
        archivedBlock = '---' + block + '---';
        // 次のブロック（本文）も含める
        if (blocks[i + 1]) {
          archivedBlock += blocks[i + 1];
          i++; // 次のブロックをスキップ
        }
      } else {
        remainingBlocks.push(block);
      }
    }

    if (!archivedBlock) {
      return { success: false, error: 'Mention ID not found' };
    }

    // archive.mdに追加
    const { content: archiveContent } = await this.getFileContent({ owner, repo, branch, path: archivePath });
    const newArchiveContent = (archiveContent || '# Archived Inbox Items\n\n') + archivedBlock + '\n';

    // pending.mdを更新
    const newPendingContent = remainingBlocks.join('---');

    // 両方のファイルを更新（順番に）
    await this.createOrUpdateFile({
      owner,
      repo,
      branch,
      path: archivePath,
      content: newArchiveContent,
      message: `inbox: archive ${mentionId}`
    });

    await this.createOrUpdateFile({
      owner,
      repo,
      branch,
      path: pendingPath,
      content: newPendingContent,
      message: `inbox: remove archived ${mentionId}`
    });

    return { success: true, mentionId };
  }
}

module.exports = GitHubIntegration;
