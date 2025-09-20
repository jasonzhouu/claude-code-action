import * as core from "@actions/core";
import { GITHUB_API_URL, GITHUB_SERVER_URL } from "../github/api/config";
import { GITLAB_API_URL } from "../gitlab/api/config";
import type { GitHubContext } from "../github/context";
import type { GitLabContext } from "../gitlab/context";
import { isEntityContext } from "../github/context";
import { isGitLabCI } from "../gitlab/context";
import { Octokit } from "@octokit/rest";
import type { AutoDetectedMode } from "../modes/detector";

type PrepareConfigParams = {
  githubToken?: string;
  gitlabToken?: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  claudeCommentId?: string;
  allowedTools: string[];
  mode: AutoDetectedMode;
  context: GitHubContext | GitLabContext;
};

async function checkActionsReadPermission(
  token: string,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    const client = new Octokit({ auth: token, baseUrl: GITHUB_API_URL });

    // Try to list workflow runs - this requires actions:read
    // We use per_page=1 to minimize the response size
    await client.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: 1,
    });

    return true;
  } catch (error: any) {
    // Check if it's a permission error
    if (
      error.status === 403 &&
      error.message?.includes("Resource not accessible")
    ) {
      return false;
    }

    // For other errors (network issues, etc), log but don't fail
    core.debug(`Failed to check actions permission: ${error.message}`);
    return false;
  }
}

export async function prepareMcpConfig(
  params: PrepareConfigParams,
): Promise<string> {
  const {
    githubToken,
    gitlabToken,
    owner,
    repo,
    branch,
    baseBranch,
    claudeCommentId,
    allowedTools,
    context,
    mode,
  } = params;
  try {
    const allowedToolsList = allowedTools || [];
    const isGitLabMode = isGitLabCI();

    // Detect if we're in agent mode (explicit prompt provided)
    const isAgentMode = mode === "agent";

    // GitHub tool detection
    const hasGitHubCommentTools = allowedToolsList.some((tool) =>
      tool.startsWith("mcp__github_comment__"),
    );

    const hasGitHubMcpTools = allowedToolsList.some((tool) =>
      tool.startsWith("mcp__github__"),
    );

    const hasInlineCommentTools = allowedToolsList.some((tool) =>
      tool.startsWith("mcp__github_inline_comment__"),
    );

    const hasGitHubCITools = allowedToolsList.some((tool) =>
      tool.startsWith("mcp__github_ci__"),
    );

    // GitLab tool detection
    const hasGitLabCommentTools = allowedToolsList.some((tool) =>
      tool.startsWith("mcp__gitlab_comment__"),
    );

    const hasGitLabFileOpsTools = allowedToolsList.some((tool) =>
      tool.startsWith("mcp__gitlab_file_ops__"),
    );

    const baseMcpConfig: { mcpServers: Record<string, unknown> } = {
      mcpServers: {},
    };

    // Configure servers based on platform
    if (isGitLabMode) {
      // GitLab CI mode
      const shouldIncludeGitLabCommentServer = !isAgentMode || hasGitLabCommentTools;

      if (shouldIncludeGitLabCommentServer) {
        baseMcpConfig.mcpServers.gitlab_comment = {
          command: "bun",
          args: [
            "run",
            `${process.env.GITHUB_ACTION_PATH || process.cwd()}/src/mcp/gitlab-comment-server.ts`,
          ],
          env: {
            GITLAB_TOKEN: gitlabToken,
            GITLAB_PROJECT_ID: process.env.CI_PROJECT_ID || process.env.GITLAB_PROJECT_ID,
            GITLAB_PROJECT_PATH: process.env.CI_PROJECT_PATH || process.env.GITLAB_PROJECT_PATH,
            ...(claudeCommentId && { CLAUDE_COMMENT_ID: claudeCommentId }),
            CI_MERGE_REQUEST_IID: process.env.CI_MERGE_REQUEST_IID,
            GITLAB_ISSUE_IID: process.env.GITLAB_ISSUE_IID,
            GITLAB_API_URL: GITLAB_API_URL,
          },
        };
      }

      // Include GitLab file ops server when needed
      if (context.inputs?.useCommitSigning || hasGitLabFileOpsTools) {
        baseMcpConfig.mcpServers.gitlab_file_ops = {
          command: "bun",
          args: [
            "run",
            `${process.env.GITHUB_ACTION_PATH || process.cwd()}/src/mcp/gitlab-file-ops-server.ts`,
          ],
          env: {
            GITLAB_TOKEN: gitlabToken,
            GITLAB_PROJECT_ID: process.env.CI_PROJECT_ID || process.env.GITLAB_PROJECT_ID,
            GITLAB_PROJECT_PATH: process.env.CI_PROJECT_PATH || process.env.GITLAB_PROJECT_PATH,
            BRANCH_NAME: branch,
            BASE_BRANCH: baseBranch,
            REPO_DIR: process.env.CI_PROJECT_DIR || process.cwd(),
            GITLAB_API_URL: GITLAB_API_URL,
          },
        };
      }
    } else {
      // GitHub Actions mode (existing code)
      const shouldIncludeCommentServer = !isAgentMode || hasGitHubCommentTools;

      if (shouldIncludeCommentServer) {
        baseMcpConfig.mcpServers.github_comment = {
          command: "bun",
          args: [
            "run",
            `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-comment-server.ts`,
          ],
          env: {
            GITHUB_TOKEN: githubToken,
            REPO_OWNER: owner,
            REPO_NAME: repo,
            ...(claudeCommentId && { CLAUDE_COMMENT_ID: claudeCommentId }),
            GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "",
            GITHUB_API_URL: GITHUB_API_URL,
          },
        };
      }

      // Include file ops server when commit signing is enabled
      if (context.inputs?.useCommitSigning) {
        baseMcpConfig.mcpServers.github_file_ops = {
          command: "bun",
          args: [
            "run",
            `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-file-ops-server.ts`,
          ],
          env: {
            GITHUB_TOKEN: githubToken,
            REPO_OWNER: owner,
            REPO_NAME: repo,
            BRANCH_NAME: branch,
            BASE_BRANCH: baseBranch,
            REPO_DIR: process.env.GITHUB_WORKSPACE || process.cwd(),
            GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "",
            IS_PR: process.env.IS_PR || "false",
            GITHUB_API_URL: GITHUB_API_URL,
          },
        };
      }

      // Include inline comment server for PRs when requested via allowed tools
      if (
        isEntityContext(context as any) &&
        (context as any).isPR &&
        (hasGitHubMcpTools || hasInlineCommentTools)
      ) {
        baseMcpConfig.mcpServers.github_inline_comment = {
          command: "bun",
          args: [
            "run",
            `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-inline-comment-server.ts`,
          ],
          env: {
            GITHUB_TOKEN: githubToken,
            REPO_OWNER: owner,
            REPO_NAME: repo,
            PR_NUMBER: (context as any).entityNumber?.toString() || "",
            GITHUB_API_URL: GITHUB_API_URL,
          },
        };
      }

      // CI server is included when:
      // - In tag mode: when we have a workflow token and context is a PR
      // - In agent mode: same conditions PLUS explicit CI tools in allowedTools
      const hasWorkflowToken = !!process.env.DEFAULT_WORKFLOW_TOKEN;
      const shouldIncludeCIServer =
        (!isAgentMode || hasGitHubCITools) &&
        isEntityContext(context as any) &&
        (context as any).isPR &&
        hasWorkflowToken;

      if (shouldIncludeCIServer) {
        // Verify the token actually has actions:read permission
        const actuallyHasPermission = await checkActionsReadPermission(
          process.env.DEFAULT_WORKFLOW_TOKEN || "",
          owner,
          repo,
        );

        if (!actuallyHasPermission) {
          core.warning(
            "The github_ci MCP server requires 'actions: read' permission. " +
              "Please ensure your GitHub token has this permission. " +
              "See: https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token",
          );
        }
        baseMcpConfig.mcpServers.github_ci = {
          command: "bun",
          args: [
            "run",
            `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-actions-server.ts`,
          ],
          env: {
            // Use workflow github token, not app token
            GITHUB_TOKEN: process.env.DEFAULT_WORKFLOW_TOKEN,
            REPO_OWNER: owner,
            REPO_NAME: repo,
            PR_NUMBER: (context as any).entityNumber?.toString() || "",
            RUNNER_TEMP: process.env.RUNNER_TEMP || "/tmp",
          },
        };
      }

      if (hasGitHubMcpTools) {
        baseMcpConfig.mcpServers.github = {
          command: "docker",
          args: [
            "run",
            "-i",
            "--rm",
            "-e",
            "GITHUB_PERSONAL_ACCESS_TOKEN",
            "-e",
            "GITHUB_HOST",
            "ghcr.io/github/github-mcp-server:sha-efef8ae", // https://github.com/github/github-mcp-server/releases/tag/v0.9.0
          ],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
            GITHUB_HOST: GITHUB_SERVER_URL,
          },
        };
      }
    }

    // Return config for the appropriate platform
    // User's config will be passed as separate --mcp-config flags
    return JSON.stringify(baseMcpConfig, null, 2);
  } catch (error) {
    core.setFailed(`Install MCP server failed with error: ${error}`);
    process.exit(1);
  }
}
