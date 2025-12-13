/**
 * meeting-decision-commit.test.js
 * 議事録から抽出した決定事項をプロジェクトGitHubの_codex/decisions/にコミットする機能のテスト
 * TDD: RED -> GREEN -> REFACTOR
 *
 * 機能仕様:
 * - 議事録生成時に抽出されたdecisions配列を受け取る
 * - プロジェクトIDに対応するGitHubリポジトリを特定
 * - _codex/decisions/YYYY-MM-DD_{slug}.md を作成してコミット
 * - 決定事項のMarkdownフォーマットを生成
 */

// axiosのモック
const mockAxios = {
  get: jest.fn(),
  put: jest.fn()
};

jest.mock('axios', () => mockAxios);

// config.yml のモック
const mockConfig = {
  projects: [
    {
      id: 'salestailor',
      github: { owner: 'Unson-LLC', repo: 'salestailor', branch: 'main' }
    },
    {
      id: 'zeims',
      github: { owner: 'Unson-LLC', repo: 'zeims-project', branch: 'main' }
    },
    {
      id: 'tech-knight',
      github: { owner: 'Tech-Knight-inc', repo: 'tech-knight-project', branch: 'main' }
    },
    {
      id: 'ai-wolf',
      // github設定なし
    }
  ]
};

jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(JSON.stringify(mockConfig)),
  existsSync: jest.fn().mockReturnValue(true)
}));

jest.mock('js-yaml', () => ({
  load: jest.fn().mockImplementation((content) => JSON.parse(content))
}));

describe('MeetingDecisionCommit', () => {
  let commitDecisions;
  let generateDecisionMarkdown;
  let generateDecisionSlug;
  let getGitHubRepoForProject;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockAxios.get.mockReset();
    mockAxios.put.mockReset();

    // 環境変数設定
    process.env.GITHUB_TOKEN = 'test-token';

    // 実装モジュールを読み込む
    try {
      const module = require('../meeting-decision-commit');
      commitDecisions = module.commitDecisions;
      generateDecisionMarkdown = module.generateDecisionMarkdown;
      generateDecisionSlug = module.generateDecisionSlug;
      getGitHubRepoForProject = module.getGitHubRepoForProject;
    } catch (e) {
      // RED状態: モジュールが存在しない
    }
  });

  describe('generateDecisionSlug', () => {
    it('決定事項の内容からslugを生成する', () => {
      const content = '価格は月額5万円に決定';
      const result = generateDecisionSlug(content);

      // pricing, monthly, 50k が含まれていること（順序は問わない）
      expect(result).toContain('pricing');
      expect(result).toContain('monthly');
      expect(result).toContain('50k');
    });

    it('長い文字列は30文字で切り詰める', () => {
      const content = 'これは非常に長い決定事項の内容でありスラッグとしては長すぎる文字列です';
      const result = generateDecisionSlug(content);

      expect(result.length).toBeLessThanOrEqual(30);
    });

    it('特殊文字はハイフンに変換する', () => {
      const content = 'API設計：REST vs GraphQL';
      const result = generateDecisionSlug(content);

      expect(result).not.toContain(':');
      expect(result).not.toContain(' ');
    });

    it('空文字の場合はdecisionを返す', () => {
      const result = generateDecisionSlug('');
      expect(result).toBe('decision');
    });
  });

  describe('generateDecisionMarkdown', () => {
    it('決定事項からMarkdownを生成する', () => {
      const decision = {
        content: '価格は月額5万円に決定',
        context: '競合調査の結果、この価格帯が最適と判断',
        date: '2025-12-14'
      };
      const projectName = 'SalesTailor';
      const meetingDate = '2025-12-14';

      const result = generateDecisionMarkdown(decision, projectName, meetingDate);

      expect(result).toContain('# 価格は月額5万円に決定');
      expect(result).toContain('決定日: 2025-12-14');
      expect(result).toContain('ステータス: 決定');
      expect(result).toContain('## 背景');
      expect(result).toContain('競合調査の結果');
    });

    it('contextがない場合も正しく生成する', () => {
      const decision = {
        content: 'ローンチは1月予定',
        date: '2025-12-14'
      };

      const result = generateDecisionMarkdown(decision, 'Zeims', '2025-12-14');

      expect(result).toContain('# ローンチは1月予定');
      expect(result).toContain('## 背景');
    });

    it('ソースとして議事録日付を含める', () => {
      const decision = { content: 'テスト決定', date: '2025-12-14' };
      const result = generateDecisionMarkdown(decision, 'Test', '2025-12-14');

      expect(result).toContain('ソース: 2025-12-14 会議');
    });
  });

  describe('getGitHubRepoForProject', () => {
    it('プロジェクトIDに対応するGitHubリポジトリ情報を返す', () => {
      const result = getGitHubRepoForProject('salestailor');

      expect(result).toEqual({
        owner: 'Unson-LLC',
        repo: 'salestailor',
        branch: 'main'
      });
    });

    it('GitHub設定がないプロジェクトはnullを返す', () => {
      const result = getGitHubRepoForProject('ai-wolf');
      expect(result).toBeNull();
    });

    it('存在しないプロジェクトはnullを返す', () => {
      const result = getGitHubRepoForProject('unknown-project');
      expect(result).toBeNull();
    });
  });

  describe('commitDecisions', () => {
    it('decisionsをGitHubリポジトリにコミットする', async () => {
      // Given
      const decisions = [
        { content: '価格は月額5万円に決定', context: '競合調査の結果', date: '2025-12-14' },
        { content: 'ローンチは1月予定', context: '', date: '2025-12-14' }
      ];
      const projectId = 'salestailor';
      const meetingDate = '2025-12-14';

      // _codex/decisions/ が存在しない場合（404エラー）
      mockAxios.get.mockRejectedValue({ response: { status: 404 } });
      mockAxios.put.mockResolvedValue({
        data: {
          content: { sha: 'file-sha', html_url: 'https://github.com/...' },
          commit: { sha: 'abc123', html_url: 'https://github.com/...' }
        }
      });

      // When
      const result = await commitDecisions(decisions, projectId, meetingDate);

      // Then
      expect(mockAxios.put).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.committed).toBe(2);
    });

    it('コミット時に正しいパスを使用する', async () => {
      const decisions = [
        { content: 'API設計はRESTに決定', context: '', date: '2025-12-14' }
      ];

      mockAxios.get.mockRejectedValue({ response: { status: 404 } });
      mockAxios.put.mockResolvedValue({
        data: {
          content: { sha: 'file-sha', html_url: 'https://github.com/...' },
          commit: { sha: 'abc123', html_url: 'https://github.com/...' }
        }
      });

      await commitDecisions(decisions, 'salestailor', '2025-12-14');

      // axios.put の第1引数（URL）を確認
      expect(mockAxios.put).toHaveBeenCalledWith(
        expect.stringMatching(/repos\/Unson-LLC\/salestailor\/contents\/_codex\/decisions\/2025-12-14_.+\.md/),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('既存ファイルがある場合はshaを含めて更新する', async () => {
      const decisions = [
        { content: 'テスト決定', context: '', date: '2025-12-14' }
      ];

      // 既存ファイルが存在する場合
      mockAxios.get.mockResolvedValue({
        data: { sha: 'existing-sha-123' }
      });
      mockAxios.put.mockResolvedValue({
        data: {
          content: { sha: 'new-file-sha', html_url: 'https://github.com/...' },
          commit: { sha: 'new-commit-sha', html_url: 'https://github.com/...' }
        }
      });

      await commitDecisions(decisions, 'salestailor', '2025-12-14');

      // axios.put の第2引数（ペイロード）にshaが含まれている
      expect(mockAxios.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          sha: 'existing-sha-123'
        }),
        expect.any(Object)
      );
    });

    it('空のdecisions配列の場合は何もしない', async () => {
      const result = await commitDecisions([], 'salestailor', '2025-12-14');

      expect(mockAxios.put).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.committed).toBe(0);
    });

    it('GitHub設定がないプロジェクトはエラーを返す', async () => {
      const decisions = [{ content: 'テスト', context: '', date: '2025-12-14' }];

      const result = await commitDecisions(decisions, 'ai-wolf', '2025-12-14');

      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub');
    });

    it('一部のコミットが失敗しても他は継続する', async () => {
      const decisions = [
        { content: '決定1', context: '', date: '2025-12-14' },
        { content: '決定2', context: '', date: '2025-12-14' },
        { content: '決定3', context: '', date: '2025-12-14' }
      ];

      mockAxios.get.mockRejectedValue({ response: { status: 404 } });
      mockAxios.put
        .mockResolvedValueOnce({
          data: { content: { sha: 's1' }, commit: { sha: 'c1' } }
        })
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({
          data: { content: { sha: 's3' }, commit: { sha: 'c3' } }
        });

      const result = await commitDecisions(decisions, 'salestailor', '2025-12-14');

      expect(result.committed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('コミットメッセージに会議日付を含める', async () => {
      const decisions = [
        { content: 'テスト決定', context: '', date: '2025-12-14' }
      ];

      mockAxios.get.mockRejectedValue({ response: { status: 404 } });
      mockAxios.put.mockResolvedValue({
        data: {
          content: { sha: 'file-sha' },
          commit: { sha: 'abc123' }
        }
      });

      await commitDecisions(decisions, 'salestailor', '2025-12-14');

      // axios.put の第2引数（ペイロード）にメッセージが含まれている
      expect(mockAxios.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining('2025-12-14')
        }),
        expect.any(Object)
      );
    });
  });
});
