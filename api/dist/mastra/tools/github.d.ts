import { z } from 'zod';
export declare const githubAppendTaskTool: import("@mastra/core/tools").Tool<z.ZodObject<{
    title: z.ZodString;
    projectId: z.ZodString;
    assignee: z.ZodString;
    due: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodString>;
    slackLink: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    projectId: string;
    assignee: string;
    due?: string | undefined;
    context?: string | undefined;
    slackLink?: string | undefined;
}, {
    title: string;
    projectId: string;
    assignee: string;
    due?: string | undefined;
    context?: string | undefined;
    slackLink?: string | undefined;
}>, undefined, import("@mastra/core").ToolExecutionContext<z.ZodObject<{
    title: z.ZodString;
    projectId: z.ZodString;
    assignee: z.ZodString;
    due: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodString>;
    slackLink: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    projectId: string;
    assignee: string;
    due?: string | undefined;
    context?: string | undefined;
    slackLink?: string | undefined;
}, {
    title: string;
    projectId: string;
    assignee: string;
    due?: string | undefined;
    context?: string | undefined;
    slackLink?: string | undefined;
}>>>;
export declare const githubCommitMinutesTool: import("@mastra/core/tools").Tool<z.ZodObject<{
    projectId: z.ZodString;
    date: z.ZodString;
    topic: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    projectId: string;
    date: string;
    topic: string;
    content: string;
}, {
    projectId: string;
    date: string;
    topic: string;
    content: string;
}>, undefined, import("@mastra/core").ToolExecutionContext<z.ZodObject<{
    projectId: z.ZodString;
    date: z.ZodString;
    topic: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    projectId: string;
    date: string;
    topic: string;
    content: string;
}, {
    projectId: string;
    date: string;
    topic: string;
    content: string;
}>>>;
//# sourceMappingURL=github.d.ts.map