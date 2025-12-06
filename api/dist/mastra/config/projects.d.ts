export interface ProjectConfig {
    id: string;
    name: string;
    description: string;
    airtableBaseId?: string;
    slackChannels: string[];
    brainbaseProjectPath: string;
}
export declare const projectConfigs: ProjectConfig[];
export declare function getProjectByChannel(channelName: string): ProjectConfig | undefined;
export declare function getProjectById(projectId: string): ProjectConfig | undefined;
//# sourceMappingURL=projects.d.ts.map