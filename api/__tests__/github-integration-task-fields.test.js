const GitHubIntegration = require('../github-integration');

jest.mock('axios');
const axios = require('axios');

describe('GitHubIntegration.appendTask - 新フィールド対応', () => {
  let github;

  beforeEach(() => {
    github = new GitHubIntegration();

    axios.get.mockResolvedValue({
      data: {
        content: Buffer.from('# Tasks\n').toString('base64'),
        sha: 'abc123'
      }
    });

    axios.put.mockResolvedValue({
      data: {
        commit: { sha: 'def456', html_url: 'https://github.com/...' },
        content: { sha: 'xyz789', html_url: 'https://github.com/.../file' }
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sourceフィールドが保存される', async () => {
    const task = {
      title: 'テストタスク',
      project_id: 'test-project',
      source: 'slack'
    };
    const slackLink = 'https://slack.com/...';
    const slackContext = {
      channel_id: 'C123456',
      thread_ts: '1733644800.123456'
    };

    await github.appendTask(task, slackLink, slackContext);

    const putCall = axios.put.mock.calls[0];
    const payload = putCall[1];
    const content = Buffer.from(payload.content, 'base64').toString('utf-8');

    expect(content).toContain('source: slack');
  });

  it('channel_idとthread_tsが保存される', async () => {
    const task = {
      title: 'テストタスク',
      project_id: 'test-project'
    };
    const slackLink = 'https://slack.com/...';
    const slackContext = {
      channel_id: 'C123456',
      thread_ts: '1733644800.123456'
    };

    await github.appendTask(task, slackLink, slackContext);

    const putCall = axios.put.mock.calls[0];
    const payload = putCall[1];
    const content = Buffer.from(payload.content, 'base64').toString('utf-8');

    expect(content).toContain('channel_id: C123456');
    expect(content).toContain('thread_ts: "1733644800.123456"');
  });

  it('created_atがISO8601形式で保存される', async () => {
    const task = {
      title: 'テストタスク',
      project_id: 'test-project'
    };

    await github.appendTask(task, '', {});

    const putCall = axios.put.mock.calls[0];
    const payload = putCall[1];
    const content = Buffer.from(payload.content, 'base64').toString('utf-8');

    expect(content).toMatch(/created_at: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z"/);
  });

  it('slackContextが未指定の場合はchannel_id/thread_tsが含まれない', async () => {
    const task = {
      title: 'テストタスク',
      project_id: 'test-project'
    };

    await github.appendTask(task, '');

    const putCall = axios.put.mock.calls[0];
    const payload = putCall[1];
    const content = Buffer.from(payload.content, 'base64').toString('utf-8');

    expect(content).not.toContain('channel_id:');
    expect(content).not.toContain('thread_ts:');
  });

  it('owner_slack_idが保存される', async () => {
    const task = {
      title: 'テストタスク',
      project_id: 'test-project',
      assignee: 'keigo',
      assignee_slack_id: 'U123456789'
    };
    const slackContext = {
      channel_id: 'C123456',
      thread_ts: '1733644800.123456'
    };

    await github.appendTask(task, '', slackContext);

    const putCall = axios.put.mock.calls[0];
    const payload = putCall[1];
    const content = Buffer.from(payload.content, 'base64').toString('utf-8');

    expect(content).toContain('owner_slack_id: U123456789');
  });
});
