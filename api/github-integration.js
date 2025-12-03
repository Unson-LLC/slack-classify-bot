const axios = require('axios');

class GitHubIntegration {
  constructor(token = process.env.GITHUB_TOKEN) {
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is not set');
    }
    this.token = token;
    this.baseUrl = 'https://api.github.com';
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
   * @param {string} slackLink - Slackメッセージへのリンク
   * @returns {Promise<Object>} - コミット結果
   */
  async appendTask(task, slackLink = '') {
    const owner = 'sintariran';
    const repo = 'brainbase';
    const branch = 'main';
    const path = '_tasks/index.md';

    // 現在のファイル内容を取得
    const { content: currentContent, sha } = await this.getFileContent({ owner, repo, branch, path });

    // タスクIDを生成
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const taskId = `SLACK-${dateStr}-${now.getTime().toString(36).toUpperCase()}`;

    // 担当者を決定（assigneeがあれば使用、なければkeigo）
    const owner = task.assignee || 'keigo';
    const ownerFormatted = owner.replace(' ', '-').toLowerCase();

    // タスクをYAML形式でフォーマット
    const taskEntry = `---
id: ${taskId}
title: ${task.title}
project_id: ${task.project_id || 'general'}
status: todo
owner: ${ownerFormatted}
priority: ${task.priority || 'medium'}
due: ${task.due || 'null'}
tags: [slack, auto-import]
links: []
---

- ${dateStr} Slackから自動取り込み: ${task.requester}から依頼
- 担当: ${owner}
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

    return {
      success: true,
      taskId,
      ...result
    };
  }
}

module.exports = GitHubIntegration;
