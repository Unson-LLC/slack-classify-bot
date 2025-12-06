import { Agent } from '@mastra/core/agent';
export declare const createTaskAgent: () => Agent<{
    github_append_task: import("@mastra/core/tools").Tool<import("zod").ZodObject<{
        title: import("zod").ZodString;
        projectId: import("zod").ZodString;
        assignee: import("zod").ZodString;
        due: import("zod").ZodOptional<import("zod").ZodString>;
        context: import("zod").ZodOptional<import("zod").ZodString>;
        slackLink: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
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
    }>, undefined, import("@mastra/core").ToolExecutionContext<import("zod").ZodObject<{
        title: import("zod").ZodString;
        projectId: import("zod").ZodString;
        assignee: import("zod").ZodString;
        due: import("zod").ZodOptional<import("zod").ZodString>;
        context: import("zod").ZodOptional<import("zod").ZodString>;
        slackLink: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
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
}, Record<string, import("@mastra/core").Metric>>;
//# sourceMappingURL=task-agent.d.ts.map