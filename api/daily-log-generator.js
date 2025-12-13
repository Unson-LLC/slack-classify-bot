/**
 * daily-log-generator.js
 * 日次ログ自動生成サービス
 *
 * 以下の情報を統合して日次ログを生成:
 * 1. Slack履歴: プロジェクト関連チャンネルの活動サマリ
 * 2. タスク状況: Airtableタスクの完了・追加・進行中
 * 3. 会議記録: Slackに投稿された議事録からサマリを自動抽出
 */

const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { AirtableMilestoneClient, PROJECT_BASE_MAPPING } = require('./airtable-milestone-client');
const { getChannelMapping } = require('./channel-project-resolver');

const S3_BUCKET = process.env.S3_BUCKET || 'brainbase-context-593793022993';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

class DailyLogGenerator {
  constructor() {
    this.s3Client = new S3Client({ region: AWS_REGION });
  }

  /**
   * 今日の日付をJST形式で取得
   * @returns {Object} { dateStr: 'YYYY-MM-DD', displayDate: 'M/D', weekday: '月' }
   */
  getTodayJST() {
    const now = new Date();
    const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

    const year = jst.getFullYear();
    const month = String(jst.getMonth() + 1).padStart(2, '0');
    const day = String(jst.getDate()).padStart(2, '0');

    const displayMonth = jst.getMonth() + 1;
    const displayDay = jst.getDate();

    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const weekday = weekdays[jst.getDay()];

    return {
      dateStr: `${year}-${month}-${day}`,
      displayDate: `${displayMonth}/${displayDay}`,
      weekday,
    };
  }

  /**
   * プロジェクトに関連するSlackチャンネルIDを取得
   * @param {string} projectId - プロジェクトID (zeims形式)
   * @returns {Promise<Array<{channelId: string, channelName: string}>>}
   */
  async getProjectChannels(projectId) {
    const channelMapping = await getChannelMapping();
    const channels = [];

    for (const [channelId, info] of channelMapping) {
      // project_id_short (zeims) または project_id (proj_zeims) でマッチ
      const matches = info.project_id_short === projectId ||
                      info.project_id === projectId ||
                      info.project_id === `proj_${projectId}`;
      if (matches) {
        channels.push({
          channelId,
          channelName: info.channel_name,
        });
      }
    }

    return channels;
  }

  /**
   * S3から特定日のSlackメッセージを取得
   * @param {string} channelId - チャンネルID
   * @param {string} dateStr - 日付（YYYY-MM-DD）
   * @param {string} workspaceId - ワークスペースID
   * @returns {Promise<Array>} メッセージ配列
   */
  async getSlackMessagesForDate(channelId, dateStr, workspaceId = 'unson') {
    const monthStr = dateStr.slice(0, 7);
    const key = `slack/${workspaceId}/messages/${channelId}/${monthStr}/${dateStr}.json`;

    try {
      const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      const jsonStr = await response.Body.transformToString();
      const data = JSON.parse(jsonStr);
      return data.messages || [];
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return [];
      }
      console.warn(`Failed to get messages for ${channelId}/${dateStr}:`, error.message);
      return [];
    }
  }

  /**
   * メッセージが議事録投稿かどうかを判定
   * @param {Object} message - Slackメッセージ
   * @returns {boolean}
   */
  isMeetingPost(message) {
    const text = message.text || '';

    // manaが投稿した議事録パターンを検出
    const patterns = [
      '会議要約',
      '詳細議事録',
      '議事録',
      'この議事録はAIにより',
      '### 要約',
      '### 決定事項',
      '### Next Action',
    ];

    return patterns.some(pattern => text.includes(pattern));
  }

  /**
   * 議事録メッセージからサマリ部分を抽出
   * @param {Object} message - 議事録メッセージ
   * @returns {Object} { title, summary, hasActions, threadTs }
   */
  extractMeetingInfo(message) {
    const text = message.text || '';

    // タイトル抽出（複数パターン対応）
    let title = '会議';

    // パターン1: 「○○会議」形式
    const bracketMatch = text.match(/[「『【]([^」』】]+(?:会議|MTG|ミーティング|打合せ)[^」』】]*)[」』】]/);
    if (bracketMatch) {
      title = bracketMatch[1];
    } else {
      // パターン2: :memo: 会議要約: {タイトル}.txt 形式
      const memoMatch = text.match(/会議要約[:：]\s*([^.]+)/);
      if (memoMatch) {
        title = memoMatch[1].trim();
      } else {
        // パターン3: 詳細議事録: {タイトル} 形式
        const detailMatch = text.match(/詳細議事録[:：]\s*([^.]+)/);
        if (detailMatch) {
          title = detailMatch[1].trim();
        }
      }
    }

    // 要約部分を抽出
    let summary = '';

    // "### 要約" セクションから抽出
    const summaryMatch = text.match(/###\s*要約\s*\n([\s\S]*?)(?=###|$)/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      // 最初の3行まで
      const lines = summary.split('\n').filter(l => l.trim()).slice(0, 3);
      summary = lines.join('\n');
    } else {
      // 会議要約の後の最初の段落
      const briefMatch = text.match(/会議要約[*_]*\s*\n+([\s\S]*?)(?=\n\n|📄|$)/);
      if (briefMatch) {
        summary = briefMatch[1].trim().slice(0, 200);
        if (briefMatch[1].length > 200) summary += '...';
      }
    }

    // Next Action があるかチェック
    const hasActions = text.includes('Next Action') || text.includes('アクション');

    // 投稿時刻
    const timestamp = message.ts ? new Date(parseFloat(message.ts) * 1000) : null;
    const timeStr = timestamp
      ? `${timestamp.getHours()}:${String(timestamp.getMinutes()).padStart(2, '0')}`
      : '';

    // スレッドID（重複排除用）
    const threadTs = message.thread_ts || message.ts;

    return { title, summary, hasActions, timeStr, threadTs };
  }

  /**
   * プロジェクトの会議サマリを取得
   * @param {string} projectId - プロジェクトID
   * @param {string} dateStr - 日付
   * @returns {Promise<Array>} 会議情報配列
   */
  async getMeetingSummary(projectId, dateStr) {
    const channels = await this.getProjectChannels(projectId);
    const meetingsMap = new Map(); // threadTsで重複排除

    for (const { channelId, channelName } of channels) {
      const messages = await this.getSlackMessagesForDate(channelId, dateStr, 'unson');

      // 議事録メッセージを検出
      const meetingPosts = messages.filter(m => this.isMeetingPost(m));

      for (const post of meetingPosts) {
        const info = this.extractMeetingInfo(post);
        const key = `${channelId}-${info.threadTs}`;

        // 同一スレッドの場合、最初の投稿（会議要約）を優先
        if (!meetingsMap.has(key)) {
          meetingsMap.set(key, {
            ...info,
            channelName,
          });
        }
      }
    }

    return Array.from(meetingsMap.values());
  }

  /**
   * Slackメッセージをサマリ化
   * @param {Array} messages - メッセージ配列
   * @param {string} channelName - チャンネル名
   * @returns {string} サマリテキスト
   */
  summarizeSlackMessages(messages, channelName) {
    if (!messages || messages.length === 0) {
      return null;
    }

    // ユニークユーザー数
    const users = new Set(messages.map(m => m.user_name || m.user).filter(Boolean));

    // スレッド数（thread_ts を持つユニークなもの）
    const threads = new Set(messages.filter(m => m.thread_ts).map(m => m.thread_ts));

    // 重要そうなメッセージを抽出（長文、メンション、リアクション多め）
    const importantMessages = messages
      .filter(m => {
        const text = m.text || '';
        const hasLength = text.length > 100;
        const hasMention = text.includes('<@');
        const hasReactions = (m.reactions || []).length > 0;
        return hasLength || hasMention || hasReactions;
      })
      .slice(0, 3)
      .map(m => {
        let text = m.text || '';
        // メンションをクリーンアップ
        text = text.replace(/<@[A-Z0-9]+>/g, '@user');
        // 長すぎる場合は省略
        if (text.length > 80) {
          text = text.slice(0, 77) + '...';
        }
        return `「${text}」`;
      });

    const summaryParts = [];
    summaryParts.push(`${messages.length}件のメッセージ`);
    if (users.size > 0) {
      summaryParts.push(`参加者${users.size}名`);
    }
    if (threads.size > 0) {
      summaryParts.push(`スレッド${threads.size}件`);
    }

    let summary = `#${channelName}: ${summaryParts.join('、')}`;

    if (importantMessages.length > 0) {
      summary += `\n    - ${importantMessages.join('\n    - ')}`;
    }

    return summary;
  }

  /**
   * プロジェクトのSlack活動サマリを生成
   * @param {string} projectId - プロジェクトID
   * @param {string} dateStr - 日付
   * @returns {Promise<string>} Slackサマリ
   */
  async generateSlackSummary(projectId, dateStr) {
    const channels = await this.getProjectChannels(projectId);

    if (channels.length === 0) {
      return '（関連チャンネルなし）';
    }

    const summaries = [];

    for (const { channelId, channelName } of channels) {
      // unsonワークスペースから取得（TODO: 複数ワークスペース対応）
      const messages = await this.getSlackMessagesForDate(channelId, dateStr, 'unson');
      const summary = this.summarizeSlackMessages(messages, channelName);
      if (summary) {
        summaries.push(summary);
      }
    }

    if (summaries.length === 0) {
      return '（Slack活動なし）';
    }

    return summaries.join('\n');
  }

  /**
   * Airtableからタスク状況を取得
   * @param {string} projectId - プロジェクトID
   * @returns {Promise<Object>} タスクサマリ
   */
  async getTaskSummary(projectId) {
    try {
      const client = new AirtableMilestoneClient(projectId);
      const Airtable = require('airtable');
      const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;

      const baseId = PROJECT_BASE_MAPPING[projectId.toLowerCase()];
      if (!baseId) {
        return { error: 'Unknown project' };
      }

      const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(baseId);

      // タスクをステータス別にカウント
      const tasks = await new Promise((resolve, reject) => {
        const allTasks = [];
        base('タスク')
          .select({
            maxRecords: 100,
            fields: ['タイトル', 'ステータス', '担当者', '期限'],
          })
          .eachPage(
            (records, fetchNextPage) => {
              allTasks.push(...records.map(r => ({
                title: r.fields['タイトル'],
                status: r.fields['ステータス'],
                assignee: r.fields['担当者'],
                deadline: r.fields['期限'],
              })));
              fetchNextPage();
            },
            (err) => {
              if (err) reject(err);
              else resolve(allTasks);
            }
          );
      });

      const completed = tasks.filter(t => t.status === '完了').length;
      const inProgress = tasks.filter(t => t.status === '進行中').length;
      const pending = tasks.filter(t => t.status === '未着手').length;
      const blocked = tasks.filter(t => t.status === 'ブロック').length;

      // 期限切れタスク
      const today = new Date().toISOString().split('T')[0];
      const overdue = tasks.filter(t =>
        t.deadline && t.deadline < today && t.status !== '完了'
      );

      return {
        total: tasks.length,
        completed,
        inProgress,
        pending,
        blocked,
        overdue: overdue.length,
        overdueList: overdue.slice(0, 3).map(t => t.title),
      };
    } catch (error) {
      console.error(`Failed to get task summary for ${projectId}:`, error);
      return { error: error.message };
    }
  }

  /**
   * プロジェクトの日次ログを生成
   * @param {string} projectId - プロジェクトID
   * @param {string} dateStr - 日付（省略時は今日）
   * @returns {Promise<string>} 日次ログ（マークダウン形式）
   */
  async generateDailyLog(projectId, dateStr = null) {
    const { dateStr: today } = this.getTodayJST();
    const targetDate = dateStr || today;

    // 指定日の表示用日付を計算（YYYY-MM-DD形式から直接抽出）
    const [year, month, day] = targetDate.split('-').map(Number);
    const displayDate = `${month}/${day}`;
    // 曜日計算（Zellerの公式簡易版）
    const targetDateObj = new Date(year, month - 1, day);
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const weekday = weekdays[targetDateObj.getDay()];

    const [slackSummary, taskSummary, meetingSummary] = await Promise.all([
      this.generateSlackSummary(projectId, targetDate),
      this.getTaskSummary(projectId),
      this.getMeetingSummary(projectId, targetDate),
    ]);

    // 日次ログを構築
    const logParts = [`## ${displayDate} (${weekday})`];

    // Slack活動
    logParts.push(`### Slack`);
    logParts.push(slackSummary);

    // タスク状況
    logParts.push(`### タスク`);
    if (taskSummary.error) {
      logParts.push(`（取得エラー: ${taskSummary.error}）`);
    } else {
      logParts.push(`- 完了: ${taskSummary.completed}件`);
      logParts.push(`- 進行中: ${taskSummary.inProgress}件`);
      logParts.push(`- 未着手: ${taskSummary.pending}件`);
      if (taskSummary.blocked > 0) {
        logParts.push(`- ブロック: ${taskSummary.blocked}件`);
      }
      if (taskSummary.overdue > 0) {
        logParts.push(`- ⚠️ 期限切れ: ${taskSummary.overdue}件`);
        taskSummary.overdueList.forEach(t => {
          logParts.push(`  - ${t}`);
        });
      }
    }

    // 会議
    logParts.push(`### 会議`);
    if (meetingSummary.length === 0) {
      logParts.push(`（会議なし）`);
    } else {
      for (const meeting of meetingSummary) {
        const timePrefix = meeting.timeStr ? `[${meeting.timeStr}] ` : '';
        const actionIcon = meeting.hasActions ? ' (📋 Actions)' : '';
        logParts.push(`- ${timePrefix}**${meeting.title}**${actionIcon}`);
        if (meeting.summary) {
          // サマリを整形（インデント付き）
          const summaryLines = meeting.summary.split('\n').map(l => `  ${l}`);
          logParts.push(...summaryLines);
        }
        logParts.push(`  _#${meeting.channelName}_`);
      }
    }

    return logParts.join('\n');
  }

  /**
   * 全プロジェクトの日次ログを生成してスプリントに追記
   * @param {Array<string>} projectIds - 対象プロジェクトID（省略時は全て）
   * @returns {Promise<Array>} 結果配列
   */
  async generateAndAppendAllLogs(projectIds = null) {
    const targets = projectIds || Object.keys(PROJECT_BASE_MAPPING);
    const results = [];

    for (const projectId of targets) {
      try {
        const client = new AirtableMilestoneClient(projectId);
        const currentSprint = await client.getCurrentSprint();

        if (!currentSprint) {
          console.log(`No active sprint for ${projectId}, skipping`);
          results.push({ projectId, skipped: true, reason: 'no_active_sprint' });
          continue;
        }

        const dailyLog = await this.generateDailyLog(projectId);
        await client.appendDailyLog(currentSprint.id, dailyLog);

        results.push({
          projectId,
          sprintId: currentSprint.id,
          sprintPeriod: currentSprint.period,
          success: true,
        });

        console.log(`Appended daily log to ${projectId} sprint ${currentSprint.period}`);
      } catch (error) {
        console.error(`Failed to generate/append daily log for ${projectId}:`, error);
        results.push({ projectId, error: error.message });
      }
    }

    return results;
  }
}

module.exports = { DailyLogGenerator };
