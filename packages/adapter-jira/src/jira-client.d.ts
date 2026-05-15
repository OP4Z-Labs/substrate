/**
 * Minimal ambient type declaration for the `jira-client` CommonJS module.
 *
 * jira-client doesn't ship its own types, and `@types/jira-client` isn't
 * an officially-maintained package on npm. We declare the constructor
 * surface we use; everything else is typed through the `JiraClientLike`
 * narrowed interface in `index.ts`.
 */
declare module "jira-client" {
  export default class JiraApi {
    constructor(config: {
      protocol?: string;
      host: string;
      username: string;
      password: string;
      apiVersion?: string;
      strictSSL?: boolean;
    });
    findIssue(issueKey: string): Promise<unknown>;
    searchJira(jql: string, options?: { maxResults?: number }): Promise<unknown>;
    addNewIssue(input: Record<string, unknown>): Promise<unknown>;
    updateIssue(issueKey: string, input: Record<string, unknown>): Promise<void>;
    transitionIssue(
      issueKey: string,
      input: { transition: { id: string } },
    ): Promise<void>;
    listTransitions(issueKey: string): Promise<unknown>;
  }
}
