#!/usr/bin/env node
// GitLab Comment MCP Server - Minimal server that only provides comment update functionality
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GITLAB_API_URL } from "../gitlab/api/config";
import { createGitLabClient } from "../gitlab/api/client";
import { sanitizeContent } from "../github/utils/sanitizer"; // Reuse sanitizer

// Get repository information from environment variables
const PROJECT_ID = process.env.GITLAB_PROJECT_ID || process.env.CI_PROJECT_ID;
const PROJECT_PATH = process.env.GITLAB_PROJECT_PATH || process.env.CI_PROJECT_PATH;

if (!PROJECT_ID || !PROJECT_PATH) {
  console.error(
    "Error: GITLAB_PROJECT_ID and GITLAB_PROJECT_PATH environment variables are required"
  );
  process.exit(1);
}

const server = new McpServer({
  name: "GitLab Comment Server",
  version: "0.0.1",
});

server.tool(
  "update_claude_comment",
  "Update the Claude comment with progress and results (automatically handles both issue and MR comments)",
  {
    body: z.string().describe("The updated comment content"),
  },
  async ({ body }) => {
    try {
      const gitlabToken = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN;
      const claudeCommentId = process.env.CLAUDE_COMMENT_ID;
      const mrIid = process.env.CI_MERGE_REQUEST_IID || process.env.GITLAB_MERGE_REQUEST_IID;
      const issueIid = process.env.GITLAB_ISSUE_IID;

      if (!gitlabToken) {
        throw new Error("GitLab token environment variable is required");
      }
      if (!claudeCommentId) {
        throw new Error("CLAUDE_COMMENT_ID environment variable is required");
      }

      const projectId = PROJECT_ID;
      const commentId = parseInt(claudeCommentId, 10);

      const gitlab = createGitLabClient(gitlabToken, GITLAB_API_URL);

      const sanitizedBody = sanitizeContent(body);

      if (mrIid) {
        // Update merge request comment
        await gitlab.updateMergeRequestNote(
          projectId,
          parseInt(mrIid, 10),
          commentId,
          sanitizedBody
        );
      } else if (issueIid) {
        // Update issue comment
        await gitlab.updateIssueNote(
          projectId,
          parseInt(issueIid, 10),
          commentId,
          sanitizedBody
        );
      } else {
        throw new Error("Neither merge request IID nor issue IID found in environment");
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully updated GitLab comment ${commentId}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error updating GitLab comment: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

server.tool(
  "create_claude_comment",
  "Create a new Claude comment on a merge request or issue",
  {
    body: z.string().describe("The comment content"),
  },
  async ({ body }) => {
    try {
      const gitlabToken = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN;
      const mrIid = process.env.CI_MERGE_REQUEST_IID || process.env.GITLAB_MERGE_REQUEST_IID;
      const issueIid = process.env.GITLAB_ISSUE_IID;

      if (!gitlabToken) {
        throw new Error("GitLab token environment variable is required");
      }

      const projectId = PROJECT_ID;
      const gitlab = createGitLabClient(gitlabToken, GITLAB_API_URL);

      const sanitizedBody = sanitizeContent(body);

      let result: any;
      if (mrIid) {
        // Create merge request comment
        result = await gitlab.createMergeRequestNote(
          projectId,
          parseInt(mrIid, 10),
          sanitizedBody
        );
      } else if (issueIid) {
        // Create issue comment
        result = await gitlab.createIssueNote(
          projectId,
          parseInt(issueIid, 10),
          sanitizedBody
        );
      } else {
        throw new Error("Neither merge request IID nor issue IID found in environment");
      }

      // Store comment ID for future updates
      if (result && typeof result === 'object' && 'id' in result) {
        process.env.CLAUDE_COMMENT_ID = String(result.id);
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully created GitLab comment with ID ${result?.id || 'unknown'}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error creating GitLab comment: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);