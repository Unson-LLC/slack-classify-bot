// mastra/test-init.js
// Mastra初期化テスト

// 環境変数設定（テスト用）
process.env.AWS_REGION = 'us-east-1';
process.env.LLM_PROVIDER = 'bedrock';

async function testMastraInit() {
  console.log('=== Mastra 初期化テスト ===\n');

  try {
    // ビルド済みのMastraモジュールを読み込み
    const { mastra, allAgents, getProjectPMIds, projectConfigs } = require('../dist/mastra/index.js');

    console.log('Mastra インスタンス:', mastra ? 'OK' : 'NG');
    console.log('\n登録済みエージェント:');
    for (const [name, agent] of Object.entries(allAgents)) {
      console.log(`  - ${name}: ${agent.name || 'unnamed'}`);
    }

    console.log('\nプロジェクトPM一覧:');
    const pmIds = getProjectPMIds();
    for (const pmId of pmIds) {
      console.log(`  - ${pmId}`);
    }

    console.log('\nプロジェクト設定:');
    for (const config of projectConfigs) {
      console.log(`  - ${config.id}: ${config.name} (channels: ${config.slackChannels.join(', ')})`);
    }

    // ブリッジモジュールのテスト
    const bridge = require('../dist/mastra/bridge.js');
    console.log('\nブリッジ関数:');
    console.log('  - setSlackClient:', typeof bridge.setSlackClient);
    console.log('  - summarizeMeeting:', typeof bridge.summarizeMeeting);
    console.log('  - extractTasks:', typeof bridge.extractTasks);
    console.log('  - askProjectPM:', typeof bridge.askProjectPM);

    console.log('\n=== テスト完了: 成功 ===');
    return true;
  } catch (error) {
    console.error('\n=== テスト失敗 ===');
    console.error('エラー:', error.message);
    console.error('スタック:', error.stack);
    return false;
  }
}

testMastraInit().then(success => {
  process.exit(success ? 0 : 1);
});
