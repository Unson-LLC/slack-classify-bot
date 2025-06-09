/**
 * Test data fixtures for unit and integration tests
 */

module.exports = {
  // Slack event fixtures
  slackEvents: {
    fileShare: {
      type: 'message',
      subtype: 'file_share',
      files: [{
        id: 'F123456',
        name: 'meeting-notes.txt',
        mimetype: 'text/plain',
        size: 1024,
        url_private: 'https://files.slack.com/files-pri/T123/F123/meeting-notes.txt',
        url_private_download: 'https://files.slack.com/files-pri/T123/F123/download/meeting-notes.txt'
      }],
      user: 'U123456',
      channel: 'C123456',
      ts: '1234567890.123'
    },
    
    urlVerification: {
      type: 'url_verification',
      challenge: 'test-challenge-123'
    },
    
    buttonClick: {
      type: 'block_actions',
      actions: [{
        action_id: 'select_project_button_proj1',
        value: 'proj1',
        type: 'button'
      }]
    }
  },

  // Airtable data fixtures
  airtableData: {
    projects: [
      {
        id: 'recProj1',
        fields: {
          ID: 'proj1',
          name: 'Project Alpha',
          owner: 'company',
          repo: 'project-alpha',
          type: 'internal',
          description: 'Internal project for team Alpha'
        }
      },
      {
        id: 'recProj2',
        fields: {
          ID: 'proj2',
          name: 'Project Beta',
          owner: 'company',
          repo: 'project-beta',
          type: 'client',
          description: 'Client project for Beta Corp'
        }
      }
    ],
    
    users: [
      {
        slackUserId: 'U123456',
        accessLevel: 2,
        accessibleProjects: ['proj1', 'proj2'],
        departments: ['dev'],
        employmentType: 'employee',
        email: 'user@company.com',
        name: 'Test User',
        role: 'Developer'
      },
      {
        slackUserId: 'U_CONTRACTOR',
        accessLevel: 1,
        accessibleProjects: ['proj2'],
        departments: [],
        employmentType: 'contractor',
        email: 'contractor@external.com',
        name: 'External Contractor',
        role: 'Contractor'
      }
    ]
  },

  // File content fixtures
  fileContent: {
    meetingNotes: {
      japanese: `本日のミーティング議事録

日時: 2024年6月8日 14:00-15:00
参加者: 田中、佐藤、鈴木

議題:
1. プロジェクトの進捗確認
2. 次期開発計画
3. 予算の見直し

決定事項:
- 要件定義を来週までに完成させる
- 新機能の実装は7月から開始
- 追加予算申請を検討

ネクストアクション:
- 要件定義書の作成（担当：田中）
- スケジュール案の作成（担当：佐藤）
- 予算見積もりの更新（担当：鈴木）`,

      english: `Meeting Minutes

Date: June 8, 2024, 2:00 PM - 3:00 PM
Attendees: Tanaka, Sato, Suzuki

Agenda:
1. Project progress review
2. Next development phase planning
3. Budget review

Decisions:
- Complete requirements definition by next week
- Start new feature implementation in July
- Consider additional budget request

Next Actions:
- Create requirements document (Owner: Tanaka)
- Draft schedule proposal (Owner: Sato)
- Update budget estimates (Owner: Suzuki)`,

      confidential: `役員会議事録

売上目標: 1億円
利益率: 20%
人事評価: 部長昇進候補3名
M&A検討: A社買収を検討中
戦略: 競合B社への対抗策を策定`,

      publicInfo: `技術勉強会メモ

テーマ: オープンソースツールの活用
内容: GitHubの新機能について
参加者: 開発チーム全員
次回: ベストプラクティスの共有`
    }
  },

  // Bedrock response fixtures
  bedrockResponses: {
    standard: {
      content: [{
        text: `## 会議の概要
プロジェクトの進捗確認と次期開発計画について議論し、要件定義の完成と新機能実装のスケジュールを決定しました。

## ネクストアクション
- 要件定義書の作成（担当：田中）
- スケジュール案の作成（担当：佐藤）
- 予算見積もりの更新（担当：鈴木）`
      }]
    },
    
    noActions: {
      content: [{
        text: `## 会議の概要
技術勉強会でオープンソースツールの活用について情報共有を行いました。

## ネクストアクション
ネクストアクションはありません。`
      }]
    }
  },

  // Error fixtures
  errors: {
    networkError: new Error('Network error'),
    authError: new Error('Authentication failed'),
    rateLimitError: new Error('Rate limit exceeded'),
    timeoutError: new Error('Request timeout')
  }
};