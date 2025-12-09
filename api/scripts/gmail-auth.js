#!/usr/bin/env node
/**
 * Gmail OAuth 認証スクリプト
 *
 * 使用方法:
 * 1. Google Cloud Console で Gmail API を有効化
 * 2. このスクリプトを実行: node scripts/gmail-auth.js
 * 3. ブラウザで認証
 * 4. 表示されたrefresh_tokenをコピー
 */

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const readline = require('readline');

// 環境変数またはenv.jsonから認証情報を取得
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3333/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を環境変数に設定してください');
  process.exit(1);
}

// Gmail スコープ（読み取り・送信）
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

async function main() {
  console.log('=== Gmail OAuth 認証 ===\n');
  console.log('1. Google Cloud Console で Gmail API を有効化してください:');
  console.log('   https://console.cloud.google.com/apis/library/gmail.googleapis.com\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise((resolve) => {
    rl.question('Gmail API を有効化しましたか？ (y/n): ', (answer) => {
      if (answer.toLowerCase() !== 'y') {
        console.log('Gmail API を有効化してから再実行してください。');
        process.exit(1);
      }
      rl.close();
      resolve();
    });
  });

  // 認証URLを生成
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // 必ずrefresh_tokenを取得
  });

  console.log('\n2. 以下のURLをブラウザで開いて認証してください:\n');
  console.log(authUrl);
  console.log('\n');

  // ローカルサーバーでコールバックを受け取る
  const server = http.createServer(async (req, res) => {
    const queryParams = url.parse(req.url, true).query;

    if (queryParams.code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>認証成功！</h1><p>このウィンドウを閉じてターミナルを確認してください。</p>');

      try {
        const { tokens } = await oauth2Client.getToken(queryParams.code);

        console.log('\n=== 認証成功 ===\n');
        console.log('以下の環境変数を設定してください:\n');
        console.log(`GMAIL_CLIENT_ID=${CLIENT_ID}`);
        console.log(`GMAIL_CLIENT_SECRET=${CLIENT_SECRET}`);
        console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('\n');

        if (tokens.refresh_token) {
          console.log('✅ refresh_token を取得しました');
        } else {
          console.log('⚠️  refresh_token が取得できませんでした。');
          console.log('   Google アカウント設定で接続を解除してから再試行してください:');
          console.log('   https://myaccount.google.com/connections');
        }

        server.close();
        process.exit(0);
      } catch (error) {
        console.error('トークン取得エラー:', error.message);
        server.close();
        process.exit(1);
      }
    } else if (queryParams.error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>エラー</h1><p>${queryParams.error}</p>`);
      console.error('認証エラー:', queryParams.error);
      server.close();
      process.exit(1);
    }
  });

  server.listen(3333, () => {
    console.log('認証コールバックを待機中... (http://localhost:3333)');
    console.log('ブラウザで上記URLを開いてください。\n');
  });
}

main().catch(console.error);
