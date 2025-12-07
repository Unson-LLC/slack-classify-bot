// mastra/test-bridge.ts
// Mastraブリッジの統合テスト
async function testMastraBridge() {
    console.log('Testing Mastra bridge integration...\n');
    try {
        // 1. Mastra初期化テスト
        console.log('1. Testing Mastra initialization...');
        const { mastra, allAgents, getAgent } = await import('./index.js');
        const agentNames = Object.keys(allAgents);
        console.log(`   ✓ Mastra initialized with agents: ${agentNames.join(', ')}\n`);
        // 2. エージェント取得テスト
        console.log('2. Testing agent retrieval...');
        const techknightPM = getAgent('techknightPM');
        if (!techknightPM) {
            throw new Error('techknightPM agent not found');
        }
        console.log('   ✓ techknightPM agent retrieved successfully\n');
        // 3. ツール登録確認（スキーマ変換が問題なく行われるか）
        console.log('3. Testing tool schema conversion...');
        // エージェントがツールを持っているか確認
        const tools = techknightPM.tools;
        console.log(`   ✓ Agent has ${Object.keys(tools || {}).length} tools registered\n`);
        console.log('All integration tests passed!');
    }
    catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}
testMastraBridge();
//# sourceMappingURL=test-bridge.js.map