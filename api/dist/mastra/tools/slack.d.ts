import { z } from 'zod';
export declare const slackPostMessageTool: import("@mastra/core/tools").Tool<z.ZodObject<{
    channel: z.ZodString;
    text: z.ZodString;
    threadTs: z.ZodOptional<z.ZodString>;
    blocks: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
}, "strip", z.ZodTypeAny, {
    channel: string;
    text: string;
    threadTs?: string | undefined;
    blocks?: any[] | undefined;
}, {
    channel: string;
    text: string;
    threadTs?: string | undefined;
    blocks?: any[] | undefined;
}>, undefined, import("@mastra/core").ToolExecutionContext<z.ZodObject<{
    channel: z.ZodString;
    text: z.ZodString;
    threadTs: z.ZodOptional<z.ZodString>;
    blocks: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
}, "strip", z.ZodTypeAny, {
    channel: string;
    text: string;
    threadTs?: string | undefined;
    blocks?: any[] | undefined;
}, {
    channel: string;
    text: string;
    threadTs?: string | undefined;
    blocks?: any[] | undefined;
}>>>;
export declare const slackAddReactionTool: import("@mastra/core/tools").Tool<z.ZodObject<{
    channel: z.ZodString;
    timestamp: z.ZodString;
    emoji: z.ZodString;
}, "strip", z.ZodTypeAny, {
    channel: string;
    timestamp: string;
    emoji: string;
}, {
    channel: string;
    timestamp: string;
    emoji: string;
}>, undefined, import("@mastra/core").ToolExecutionContext<z.ZodObject<{
    channel: z.ZodString;
    timestamp: z.ZodString;
    emoji: z.ZodString;
}, "strip", z.ZodTypeAny, {
    channel: string;
    timestamp: string;
    emoji: string;
}, {
    channel: string;
    timestamp: string;
    emoji: string;
}>>>;
export declare const slackGetUserInfoTool: import("@mastra/core/tools").Tool<z.ZodObject<{
    userId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
}, {
    userId: string;
}>, undefined, import("@mastra/core").ToolExecutionContext<z.ZodObject<{
    userId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
}, {
    userId: string;
}>>>;
//# sourceMappingURL=slack.d.ts.map