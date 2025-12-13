// mastra/tools/calendar.ts
// Google Calendar API ツール（Mastra用）
// 日程調整・空き時間検索機能
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { calendar } from '@googleapis/calendar';
import { OAuth2Client } from 'google-auth-library';
// OAuth2クライアント（Gmail認証と共有）
let oauth2Client = null;
let calendarClient = null;
function getOAuth2Client() {
    if (!oauth2Client) {
        const clientId = process.env.GMAIL_CLIENT_ID;
        const clientSecret = process.env.GMAIL_CLIENT_SECRET;
        const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error('Google OAuth credentials not configured. Required: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN');
        }
        oauth2Client = new OAuth2Client(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
    }
    return oauth2Client;
}
function getCalendarClient() {
    if (!calendarClient) {
        calendarClient = calendar({ version: 'v3', auth: getOAuth2Client() });
    }
    return calendarClient;
}
/**
 * 日付をISO 8601形式に変換
 */
function toISOString(date, endOfDay = false) {
    // 既にISO形式の場合はそのまま返す
    if (date.includes('T')) {
        return date;
    }
    // YYYY-MM-DD形式の場合、時刻を追加
    if (endOfDay) {
        return `${date}T23:59:59+09:00`;
    }
    return `${date}T00:00:00+09:00`;
}
/**
 * イベント情報を整形
 */
function formatEvent(event) {
    return {
        id: event.id || '',
        summary: event.summary || '（タイトルなし）',
        start: event.start?.dateTime || event.start?.date || '',
        end: event.end?.dateTime || event.end?.date || '',
        location: event.location || '',
        attendees: (event.attendees || []).map(a => a.email || '').filter(Boolean),
        status: event.status || 'confirmed',
    };
}
/**
 * カレンダー一覧取得ツール
 */
export const calendarListCalendarsTool = createTool({
    id: 'calendar_list_calendars',
    description: 'アクセス可能なGoogleカレンダーの一覧を取得します。共有カレンダーも含まれます。',
    inputSchema: z.object({
        showHidden: z.boolean().optional().default(false).describe('非表示のカレンダーも含めるか'),
    }),
    outputSchema: z.object({
        calendars: z.array(z.object({
            id: z.string(),
            summary: z.string(),
            description: z.string(),
            accessRole: z.string(),
            primary: z.boolean(),
        })),
        total: z.number(),
    }),
    execute: async (input) => {
        const { showHidden = false } = input;
        try {
            const client = getCalendarClient();
            const response = await client.calendarList.list({
                showHidden,
            });
            const calendars = (response.data.items || []).map(cal => ({
                id: cal.id || '',
                summary: cal.summary || '',
                description: cal.description || '',
                accessRole: cal.accessRole || '',
                primary: cal.primary || false,
            }));
            console.log(`[Calendar] Found ${calendars.length} calendars`);
            return { calendars, total: calendars.length };
        }
        catch (error) {
            console.error('[Calendar] List calendars error:', error.message);
            throw new Error(`カレンダー一覧取得に失敗しました: ${error.message}`);
        }
    },
});
/**
 * イベント一覧取得ツール
 */
export const calendarListEventsTool = createTool({
    id: 'calendar_list_events',
    description: '指定期間のカレンダーイベント一覧を取得します。',
    inputSchema: z.object({
        calendarId: z.string().optional().default('primary').describe('カレンダーID（デフォルト: primary）'),
        timeMin: z.string().describe('開始日時（YYYY-MM-DD または ISO 8601形式）'),
        timeMax: z.string().describe('終了日時（YYYY-MM-DD または ISO 8601形式）'),
        maxResults: z.number().optional().default(50).describe('最大取得件数（デフォルト: 50）'),
        singleEvents: z.boolean().optional().default(true).describe('繰り返しイベントを展開するか'),
    }),
    outputSchema: z.object({
        events: z.array(z.object({
            id: z.string(),
            summary: z.string(),
            start: z.string(),
            end: z.string(),
            location: z.string(),
            attendees: z.array(z.string()),
            status: z.string(),
        })),
        total: z.number(),
    }),
    execute: async (input) => {
        const { calendarId = 'primary', timeMin, timeMax, maxResults = 50, singleEvents = true } = input;
        try {
            const client = getCalendarClient();
            const response = await client.events.list({
                calendarId,
                timeMin: toISOString(timeMin),
                timeMax: toISOString(timeMax, true),
                maxResults,
                singleEvents,
                orderBy: 'startTime',
            });
            const events = (response.data.items || [])
                .filter(event => event.status !== 'cancelled')
                .map(formatEvent);
            console.log(`[Calendar] Found ${events.length} events in ${calendarId}`);
            return { events, total: events.length };
        }
        catch (error) {
            console.error('[Calendar] List events error:', error.message);
            throw new Error(`イベント一覧取得に失敗しました: ${error.message}`);
        }
    },
});
/**
 * Free/Busy（空き時間）取得ツール
 */
export const calendarGetFreeBusyTool = createTool({
    id: 'calendar_get_freebusy',
    description: '指定したカレンダーの空き時間情報（Free/Busy）を取得します。複数カレンダーを同時に照会可能です。',
    inputSchema: z.object({
        calendarIds: z.array(z.string()).describe('カレンダーIDの配列'),
        timeMin: z.string().describe('開始日時（YYYY-MM-DD または ISO 8601形式）'),
        timeMax: z.string().describe('終了日時（YYYY-MM-DD または ISO 8601形式）'),
    }),
    outputSchema: z.object({
        calendars: z.record(z.object({
            busy: z.array(z.object({
                start: z.string(),
                end: z.string(),
            })),
        })),
        timeMin: z.string(),
        timeMax: z.string(),
    }),
    execute: async (input) => {
        const { calendarIds, timeMin, timeMax } = input;
        try {
            const client = getCalendarClient();
            const response = await client.freebusy.query({
                requestBody: {
                    timeMin: toISOString(timeMin),
                    timeMax: toISOString(timeMax, true),
                    timeZone: 'Asia/Tokyo',
                    items: calendarIds.map(id => ({ id })),
                },
            });
            const calendars = {};
            for (const [calId, data] of Object.entries(response.data.calendars || {})) {
                calendars[calId] = {
                    busy: (data.busy || []).map(slot => ({
                        start: slot.start || '',
                        end: slot.end || '',
                    })),
                };
            }
            console.log(`[Calendar] FreeBusy query for ${calendarIds.length} calendars`);
            return {
                calendars,
                timeMin: toISOString(timeMin),
                timeMax: toISOString(timeMax, true),
            };
        }
        catch (error) {
            console.error('[Calendar] FreeBusy error:', error.message);
            throw new Error(`空き時間取得に失敗しました: ${error.message}`);
        }
    },
});
/**
 * 共通空き時間検索ツール
 */
export const calendarFindCommonAvailabilityTool = createTool({
    id: 'calendar_find_common_availability',
    description: '複数のカレンダーの共通空き時間を検索します。日程調整に使用します。',
    inputSchema: z.object({
        calendarIds: z.array(z.string()).describe('カレンダーIDの配列（参加者全員分）'),
        timeMin: z.string().describe('検索開始日（YYYY-MM-DD）'),
        timeMax: z.string().describe('検索終了日（YYYY-MM-DD）'),
        durationMinutes: z.number().optional().default(60).describe('必要な時間（分）。デフォルト: 60分'),
        workingHoursOnly: z.boolean().optional().default(true).describe('営業時間内のみ（9:00-18:00）'),
    }),
    outputSchema: z.object({
        availableSlots: z.array(z.object({
            start: z.string(),
            end: z.string(),
            durationMinutes: z.number(),
        })),
        totalSlots: z.number(),
        searchPeriod: z.object({
            from: z.string(),
            to: z.string(),
        }),
    }),
    execute: async (input) => {
        const { calendarIds, timeMin, timeMax, durationMinutes = 60, workingHoursOnly = true } = input;
        try {
            const client = getCalendarClient();
            // まずFreeBusyを取得
            const response = await client.freebusy.query({
                requestBody: {
                    timeMin: toISOString(timeMin),
                    timeMax: toISOString(timeMax, true),
                    timeZone: 'Asia/Tokyo',
                    items: calendarIds.map(id => ({ id })),
                },
            });
            // 全カレンダーのbusy時間を統合
            const allBusySlots = [];
            for (const data of Object.values(response.data.calendars || {})) {
                for (const slot of data.busy || []) {
                    if (slot.start && slot.end) {
                        allBusySlots.push({
                            start: new Date(slot.start),
                            end: new Date(slot.end),
                        });
                    }
                }
            }
            // busy時間をソート
            allBusySlots.sort((a, b) => a.start.getTime() - b.start.getTime());
            // 空き時間を計算
            const availableSlots = [];
            const searchStart = new Date(toISOString(timeMin));
            const searchEnd = new Date(toISOString(timeMax, true));
            // 日ごとに空き時間を計算
            const currentDate = new Date(searchStart);
            while (currentDate < searchEnd) {
                const dayStart = new Date(currentDate);
                const dayEnd = new Date(currentDate);
                if (workingHoursOnly) {
                    dayStart.setHours(9, 0, 0, 0);
                    dayEnd.setHours(18, 0, 0, 0);
                }
                else {
                    dayStart.setHours(0, 0, 0, 0);
                    dayEnd.setHours(23, 59, 59, 999);
                }
                // 週末をスキップ（営業時間のみモードの場合）
                const dayOfWeek = currentDate.getDay();
                if (workingHoursOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
                    currentDate.setDate(currentDate.getDate() + 1);
                    continue;
                }
                // この日のbusy時間を取得
                const dayBusy = allBusySlots.filter(slot => slot.start < dayEnd && slot.end > dayStart);
                // 空き時間を探す
                let slotStart = dayStart;
                for (const busy of dayBusy) {
                    const busyStart = busy.start < dayStart ? dayStart : busy.start;
                    const busyEnd = busy.end > dayEnd ? dayEnd : busy.end;
                    if (slotStart < busyStart) {
                        const slotDuration = (busyStart.getTime() - slotStart.getTime()) / (1000 * 60);
                        if (slotDuration >= durationMinutes) {
                            availableSlots.push({
                                start: slotStart.toISOString(),
                                end: busyStart.toISOString(),
                                durationMinutes: Math.floor(slotDuration),
                            });
                        }
                    }
                    slotStart = busyEnd > slotStart ? busyEnd : slotStart;
                }
                // 最後のbusy以降の空き時間
                if (slotStart < dayEnd) {
                    const slotDuration = (dayEnd.getTime() - slotStart.getTime()) / (1000 * 60);
                    if (slotDuration >= durationMinutes) {
                        availableSlots.push({
                            start: slotStart.toISOString(),
                            end: dayEnd.toISOString(),
                            durationMinutes: Math.floor(slotDuration),
                        });
                    }
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
            console.log(`[Calendar] Found ${availableSlots.length} available slots for ${calendarIds.length} calendars`);
            return {
                availableSlots,
                totalSlots: availableSlots.length,
                searchPeriod: {
                    from: timeMin,
                    to: timeMax,
                },
            };
        }
        catch (error) {
            console.error('[Calendar] Find availability error:', error.message);
            throw new Error(`空き時間検索に失敗しました: ${error.message}`);
        }
    },
});
/**
 * 今日・明日のスケジュール取得ツール
 */
export const calendarGetTodayScheduleTool = createTool({
    id: 'calendar_get_today_schedule',
    description: '今日または明日のスケジュールを取得します。',
    inputSchema: z.object({
        calendarIds: z.array(z.string()).optional().describe('カレンダーIDの配列（省略時はprimary）'),
        day: z.enum(['today', 'tomorrow']).optional().default('today').describe('取得する日（today/tomorrow）'),
    }),
    outputSchema: z.object({
        date: z.string(),
        events: z.array(z.object({
            id: z.string(),
            summary: z.string(),
            start: z.string(),
            end: z.string(),
            location: z.string(),
            attendees: z.array(z.string()),
            status: z.string(),
            calendarId: z.string(),
        })),
        total: z.number(),
    }),
    execute: async (input) => {
        const { calendarIds = ['primary'], day = 'today' } = input;
        try {
            const client = getCalendarClient();
            // 日付を計算（JST）
            const now = new Date();
            const targetDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
            if (day === 'tomorrow') {
                targetDate.setDate(targetDate.getDate() + 1);
            }
            const dateStr = targetDate.toISOString().split('T')[0];
            const timeMin = `${dateStr}T00:00:00+09:00`;
            const timeMax = `${dateStr}T23:59:59+09:00`;
            // 全カレンダーのイベントを取得
            const allEvents = [];
            for (const calendarId of calendarIds) {
                try {
                    const response = await client.events.list({
                        calendarId,
                        timeMin,
                        timeMax,
                        singleEvents: true,
                        orderBy: 'startTime',
                    });
                    const events = (response.data.items || [])
                        .filter(event => event.status !== 'cancelled')
                        .map(event => ({
                        ...formatEvent(event),
                        calendarId,
                    }));
                    allEvents.push(...events);
                }
                catch (e) {
                    console.warn(`[Calendar] Could not access calendar ${calendarId}: ${e.message}`);
                }
            }
            // 開始時刻でソート
            allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            console.log(`[Calendar] ${day}: ${allEvents.length} events`);
            return {
                date: dateStr,
                events: allEvents,
                total: allEvents.length,
            };
        }
        catch (error) {
            console.error('[Calendar] Get today schedule error:', error.message);
            throw new Error(`スケジュール取得に失敗しました: ${error.message}`);
        }
    },
});
//# sourceMappingURL=calendar.js.map