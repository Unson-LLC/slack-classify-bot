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
}

module.exports = GitHubIntegration;
