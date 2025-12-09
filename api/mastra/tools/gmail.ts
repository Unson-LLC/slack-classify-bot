// mastra/tools/gmail.ts
// Gmail API ツール（Mastra用）- 軽量版

import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import { gmail_v1, gmail } from '@googleapis/gmail';
import { OAuth2Client } from 'google-auth-library';

// OAuth2クライアント（シングルトン）
let oauth2Client: OAuth2Client | null = null;
let gmailClient: gmail_v1.Gmail | null = null;

function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Gmail OAuth credentials not configured. Required: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN');
    }

    oauth2Client = new OAuth2Client(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
  }
  return oauth2Client;
}

function getGmailClient(): gmail_v1.Gmail {
  if (!gmailClient) {
    gmailClient = gmail({ version: 'v1', auth: getOAuth2Client() });
  }
  return gmailClient;
}

/**
 * Base64デコード（URLセーフ対応）
 */
function decodeBase64(data: string): string {
  const buff = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return buff.toString('utf-8');
}

/**
 * メールヘッダーから特定のヘッダー値を取得
 */
function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

/**
 * メール本文を抽出
 */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
    // text/plainがなければtext/htmlを試す
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        // HTMLタグを除去して簡易テキスト化
        return decodeBase64(part.body.data).replace(/<[^>]*>/g, '');
      }
    }
    // マルチパートを再帰的に処理
    for (const part of payload.parts) {
      if (part.parts) {
        const body = extractBody(part);
        if (body) return body;
      }
    }
  }

  return '';
}

/**
 * Gmail メール一覧取得ツール
 */
export const gmailListMessagesTool = createTool({
  id: 'gmail_list_messages',
  description: 'Gmailの受信トレイからメール一覧を取得します。検索クエリで絞り込み可能。',
  inputSchema: z.object({
    query: z.string().optional().describe('Gmail検索クエリ（例: "from:example@gmail.com", "is:unread", "subject:重要"）'),
    maxResults: z.number().optional().default(10).describe('取得する最大件数（デフォルト: 10）'),
    labelIds: z.array(z.string()).optional().describe('フィルターするラベルID（例: ["INBOX", "UNREAD"]）'),
  }),
  outputSchema: z.object({
    messages: z.array(z.object({
      id: z.string(),
      threadId: z.string(),
      snippet: z.string(),
      from: z.string(),
      subject: z.string(),
      date: z.string(),
    })),
    total: z.number(),
  }),
  execute: async (input) => {
    const { query, maxResults = 10, labelIds } = input;

    try {
      const client = getGmailClient();

      // メッセージ一覧を取得
      const listResponse = await client.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
        labelIds,
      });

      const messageList = listResponse.data.messages || [];

      // 各メッセージの詳細を取得
      const messages = await Promise.all(
        messageList.map(async (msg) => {
          const detail = await client.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });

          const headers = detail.data.payload?.headers;

          return {
            id: msg.id!,
            threadId: msg.threadId!,
            snippet: detail.data.snippet || '',
            from: getHeader(headers, 'From'),
            subject: getHeader(headers, 'Subject'),
            date: getHeader(headers, 'Date'),
          };
        })
      );

      console.log(`[Gmail] Found ${messages.length} messages`);
      return { messages, total: messages.length };
    } catch (error: any) {
      console.error('[Gmail] List messages error:', error.message);
      throw new Error(`Gmail メール一覧取得に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Gmail メール詳細取得ツール
 */
export const gmailGetMessageTool = createTool({
  id: 'gmail_get_message',
  description: '特定のGmailメッセージの詳細（本文含む）を取得します。',
  inputSchema: z.object({
    messageId: z.string().describe('メッセージID'),
  }),
  outputSchema: z.object({
    id: z.string(),
    threadId: z.string(),
    from: z.string(),
    to: z.string(),
    subject: z.string(),
    date: z.string(),
    body: z.string(),
    labels: z.array(z.string()),
  }),
  execute: async (input) => {
    const { messageId } = input;

    try {
      const client = getGmailClient();

      const response = await client.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const headers = response.data.payload?.headers;
      const body = extractBody(response.data.payload);

      console.log(`[Gmail] Retrieved message ${messageId}`);
      return {
        id: response.data.id || messageId,
        threadId: response.data.threadId || '',
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        body: body.substring(0, 10000), // 本文は10000文字まで
        labels: response.data.labelIds || [],
      };
    } catch (error: any) {
      console.error('[Gmail] Get message error:', error.message);
      throw new Error(`Gmail メール取得に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Gmail メール検索ツール
 */
export const gmailSearchMessagesTool = createTool({
  id: 'gmail_search_messages',
  description: 'Gmailをキーワードで検索します。複合条件も可能。',
  inputSchema: z.object({
    keywords: z.string().describe('検索キーワード'),
    from: z.string().optional().describe('送信者メールアドレス'),
    to: z.string().optional().describe('受信者メールアドレス'),
    subject: z.string().optional().describe('件名に含まれる文字列'),
    after: z.string().optional().describe('この日付以降（YYYY/MM/DD形式）'),
    before: z.string().optional().describe('この日付以前（YYYY/MM/DD形式）'),
    hasAttachment: z.boolean().optional().describe('添付ファイルがあるメールのみ'),
    isUnread: z.boolean().optional().describe('未読メールのみ'),
    maxResults: z.number().optional().default(10).describe('取得する最大件数'),
  }),
  outputSchema: z.object({
    messages: z.array(z.object({
      id: z.string(),
      threadId: z.string(),
      snippet: z.string(),
      from: z.string(),
      subject: z.string(),
      date: z.string(),
    })),
    total: z.number(),
    query: z.string(),
  }),
  execute: async (input) => {
    const { keywords, from, to, subject, after, before, hasAttachment, isUnread, maxResults = 10 } = input;

    try {
      // 検索クエリを構築
      const queryParts: string[] = [keywords];

      if (from) queryParts.push(`from:${from}`);
      if (to) queryParts.push(`to:${to}`);
      if (subject) queryParts.push(`subject:${subject}`);
      if (after) queryParts.push(`after:${after}`);
      if (before) queryParts.push(`before:${before}`);
      if (hasAttachment) queryParts.push('has:attachment');
      if (isUnread) queryParts.push('is:unread');

      const query = queryParts.join(' ');

      const client = getGmailClient();

      const listResponse = await client.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });

      const messageList = listResponse.data.messages || [];

      const messages = await Promise.all(
        messageList.map(async (msg) => {
          const detail = await client.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });

          const headers = detail.data.payload?.headers;

          return {
            id: msg.id!,
            threadId: msg.threadId!,
            snippet: detail.data.snippet || '',
            from: getHeader(headers, 'From'),
            subject: getHeader(headers, 'Subject'),
            date: getHeader(headers, 'Date'),
          };
        })
      );

      console.log(`[Gmail] Search found ${messages.length} messages for query: ${query}`);
      return { messages, total: messages.length, query };
    } catch (error: any) {
      console.error('[Gmail] Search error:', error.message);
      throw new Error(`Gmail 検索に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Gmail メール送信ツール
 */
export const gmailSendMessageTool = createTool({
  id: 'gmail_send_message',
  description: 'Gmailでメールを送信します。',
  inputSchema: z.object({
    to: z.string().describe('宛先メールアドレス'),
    subject: z.string().describe('件名'),
    body: z.string().describe('本文（プレーンテキスト）'),
    cc: z.string().optional().describe('CCメールアドレス'),
    bcc: z.string().optional().describe('BCCメールアドレス'),
  }),
  outputSchema: z.object({
    id: z.string(),
    threadId: z.string(),
    success: z.boolean(),
  }),
  execute: async (input) => {
    const { to, subject, body, cc, bcc } = input;

    try {
      const client = getGmailClient();

      // RFC 2822形式のメッセージを構築
      const messageParts = [
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
      ];

      if (cc) messageParts.splice(1, 0, `Cc: ${cc}`);
      if (bcc) messageParts.splice(1, 0, `Bcc: ${bcc}`);

      messageParts.push('');
      messageParts.push(Buffer.from(body).toString('base64'));

      const rawMessage = messageParts.join('\r\n');
      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await client.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      console.log(`[Gmail] Sent message to ${to}, id: ${response.data.id}`);
      return {
        id: response.data.id || '',
        threadId: response.data.threadId || '',
        success: true,
      };
    } catch (error: any) {
      console.error('[Gmail] Send message error:', error.message);
      throw new Error(`Gmail メール送信に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Gmail ラベル一覧取得ツール
 */
export const gmailListLabelsTool = createTool({
  id: 'gmail_list_labels',
  description: 'Gmailのラベル（フォルダ）一覧を取得します。',
  inputSchema: z.object({}),
  outputSchema: z.object({
    labels: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
    })),
  }),
  execute: async () => {
    try {
      const client = getGmailClient();

      const response = await client.users.labels.list({
        userId: 'me',
      });

      const labels = (response.data.labels || []).map((label) => ({
        id: label.id || '',
        name: label.name || '',
        type: label.type || 'user',
      }));

      console.log(`[Gmail] Found ${labels.length} labels`);
      return { labels };
    } catch (error: any) {
      console.error('[Gmail] List labels error:', error.message);
      throw new Error(`Gmail ラベル一覧取得に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Gmail スレッド取得ツール
 */
export const gmailGetThreadTool = createTool({
  id: 'gmail_get_thread',
  description: 'Gmailのスレッド（メールのやり取り）全体を取得します。',
  inputSchema: z.object({
    threadId: z.string().describe('スレッドID'),
  }),
  outputSchema: z.object({
    id: z.string(),
    messages: z.array(z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      subject: z.string(),
      date: z.string(),
      snippet: z.string(),
    })),
    total: z.number(),
  }),
  execute: async (input) => {
    const { threadId } = input;

    try {
      const client = getGmailClient();

      const response = await client.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const messages = (response.data.messages || []).map((msg) => {
        const headers = msg.payload?.headers;
        return {
          id: msg.id || '',
          from: getHeader(headers, 'From'),
          to: getHeader(headers, 'To'),
          subject: getHeader(headers, 'Subject'),
          date: getHeader(headers, 'Date'),
          snippet: msg.snippet || '',
        };
      });

      console.log(`[Gmail] Retrieved thread ${threadId} with ${messages.length} messages`);
      return {
        id: threadId,
        messages,
        total: messages.length,
      };
    } catch (error: any) {
      console.error('[Gmail] Get thread error:', error.message);
      throw new Error(`Gmail スレッド取得に失敗しました: ${error.message}`);
    }
  },
});
