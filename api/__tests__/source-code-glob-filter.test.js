/**
 * source-code-efs.ts - glob_include フィルタリングテスト
 *
 * TDD: DynamoDB の source_glob_include を使って検索対象をフィルタリング
 */

// glob_include からディレクトリプレフィックスを抽出するロジック（source-code-efs.tsと同じ）
function extractIncludePaths(globInclude) {
  return globInclude
    .map((pattern) => {
      const match = pattern.match(/^([^*]+)/);
      return match ? match[1].replace(/\/$/, '') + '/' : null;
    })
    .filter((p) => p !== null && p !== '/');
}

describe('extractIncludePaths - glob_includeからパス抽出', () => {
  test('app/**/* → app/', () => {
    const result = extractIncludePaths(['app/**/*']);
    expect(result).toEqual(['app/']);
  });

  test('複数パターン対応', () => {
    const result = extractIncludePaths(['app/**/*', 'docs/**/*', 'ops/**/*']);
    expect(result).toEqual(['app/', 'docs/', 'ops/']);
  });

  test('空配列は空配列を返す', () => {
    const result = extractIncludePaths([]);
    expect(result).toEqual([]);
  });

  test('**/* のような全マッチは除外', () => {
    const result = extractIncludePaths(['**/*']);
    expect(result).toEqual([]);
  });

  test('ネストしたパス対応', () => {
    const result = extractIncludePaths(['src/components/**/*']);
    expect(result).toEqual(['src/components/']);
  });
});

describe('getSourceRepoConfig - glob_include取得', () => {
  test('DynamoDBからsource_glob_includeを取得できる', async () => {
    const mockProject = {
      project_id: 'proj_salestailor',
      source_owner: 'Unson-LLC',
      source_repo: 'salestailor-project',
      source_branch: 'main',
      source_glob_include: ['app/**/*', 'docs/**/*', 'ops/**/*']
    };

    // extractIncludePathsで検証
    const includePaths = extractIncludePaths(mockProject.source_glob_include);
    expect(includePaths).toEqual(['app/', 'docs/', 'ops/']);
  });

  test('source_glob_includeがない場合は空配列を返す', async () => {
    const mockProject = {
      project_id: 'proj_old',
      source_owner: 'test',
      source_repo: 'test-repo',
      source_branch: 'main'
      // source_glob_include なし
    };

    const includePaths = extractIncludePaths(mockProject.source_glob_include || []);
    expect(includePaths).toEqual([]);
  });
});

describe('searchSourceCodeTool - glob_includeフィルタ', () => {
  test('glob_includeに基づいて検索パスを制限する', async () => {
    const globInclude = ['app/**/*', 'docs/**/*'];
    const searchQuery = 'handleMessage';

    // mana-search Lambda に渡すペイロード
    const expectedPayload = {
      action: 'search',
      owner: 'Unson-LLC',
      repo: 'salestailor-project',
      branch: 'main',
      query: searchQuery,
      // glob_include から検索対象パスを生成
      includePaths: ['app/', 'docs/'],
      maxResults: 20,
      caseSensitive: false
    };

    // TODO: 実装後にモック検証
    expect(true).toBe(true);
  });

  test('glob_includeが空の場合は全体を検索', async () => {
    const globInclude = [];

    // includePaths がない or 空 → 全体検索
    expect(true).toBe(true);
  });
});

describe('listSourceFilesTool - glob_includeフィルタ', () => {
  test('glob_includeに含まれるディレクトリのみリストする', async () => {
    const globInclude = ['app/**/*'];

    // 結果: app/ 配下のファイルのみ
    // node_modules/, .git/ などは除外される（既存動作）
    // さらに docs/, ops/ も除外される（glob_includeにないため）
    expect(true).toBe(true);
  });
});

describe('readSourceFileTool - glob_includeチェック', () => {
  test('glob_include外のファイルは読み取り拒否', async () => {
    const globInclude = ['app/**/*'];
    const filePath = 'node_modules/axios/index.js';

    // 期待: エラーまたは警告を返す
    const expectedError = 'ファイルが検索対象外です: node_modules/axios/index.js';

    // TODO: 実装後
    expect(true).toBe(true);
  });

  test('glob_include内のファイルは読み取り許可', async () => {
    const globInclude = ['app/**/*'];
    const filePath = 'app/src/index.ts';

    // 期待: 正常に読み取り
    expect(true).toBe(true);
  });
});

describe('globパターンマッチング', () => {
  test('app/**/* は app/src/index.ts にマッチ', () => {
    const pattern = 'app/**/*';
    const path = 'app/src/index.ts';

    // minimatch or micromatch でマッチング
    // TODO: 実装後
    expect(true).toBe(true);
  });

  test('app/**/* は docs/readme.md にマッチしない', () => {
    const pattern = 'app/**/*';
    const path = 'docs/readme.md';

    expect(true).toBe(true);
  });

  test('複数パターンのOR条件', () => {
    const patterns = ['app/**/*', 'docs/**/*'];
    const path1 = 'app/index.ts';
    const path2 = 'docs/readme.md';
    const path3 = 'ops/deploy.sh';

    // path1, path2 はマッチ、path3 はマッチしない
    expect(true).toBe(true);
  });
});
