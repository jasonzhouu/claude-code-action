#!/usr/bin/env node
// GitLab File Operations MCP Server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GITLAB_API_URL } from "../gitlab/api/config";
import { createGitLabClient } from "../gitlab/api/client";

// Get repository information from environment variables
const PROJECT_ID = process.env.GITLAB_PROJECT_ID || process.env.CI_PROJECT_ID;
const PROJECT_PATH =
  process.env.GITLAB_PROJECT_PATH || process.env.CI_PROJECT_PATH;
const BRANCH_NAME = process.env.BRANCH_NAME || process.env.CI_COMMIT_REF_NAME;

if (!PROJECT_ID || !PROJECT_PATH || !BRANCH_NAME) {
  console.error(
    "Error: GITLAB_PROJECT_ID, GITLAB_PROJECT_PATH, and BRANCH_NAME environment variables are required",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "GitLab File Operations Server",
  version: "0.0.1",
});

// Helper function to get or create branch
async function getOrCreateBranch(
  gitlab: any,
  projectId: string,
  branchName: string,
  baseBranch: string = "main",
): Promise<void> {
  try {
    // Try to get the branch
    await gitlab.getBranch(projectId, branchName);
  } catch (error) {
    // Branch doesn't exist, create it
    try {
      await gitlab.createBranch(projectId, branchName, baseBranch);
      console.log(`Created new branch: ${branchName}`);
    } catch (createError) {
      console.error(`Failed to create branch ${branchName}:`, createError);
      throw createError;
    }
  }
}

server.tool(
  "write_files_to_branch",
  "Write multiple files to a GitLab branch, creating a new commit",
  {
    files: z
      .array(
        z.object({
          path: z.string(),
          content: z.string(),
        }),
      )
      .describe("Array of files to write with their paths and content"),
    commitMessage: z
      .string()
      .describe("Commit message for the changes")
      .default("Update files via Claude"),
  },
  async ({ files, commitMessage }) => {
    const projectId = PROJECT_ID;
    const branch = BRANCH_NAME;

    try {
      const gitlabToken = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN;
      if (!gitlabToken) {
        throw new Error("GitLab token environment variable is required");
      }

      const gitlab = createGitLabClient(gitlabToken, GITLAB_API_URL);

      const processedFiles = files.map((file) => ({
        ...file,
        path: file.path.startsWith("/") ? file.path.slice(1) : file.path,
      }));

      // Ensure branch exists
      const baseBranch =
        process.env.BASE_BRANCH || process.env.CI_DEFAULT_BRANCH || "main";
      await getOrCreateBranch(gitlab, projectId, branch, baseBranch);

      // Process each file
      const results = [];
      for (const file of processedFiles) {
        try {
          // Check if file exists
          let fileExists = false;
          try {
            await gitlab.getFile(projectId, file.path, branch);
            fileExists = true;
          } catch (error) {
            // File doesn't exist, will create it
            fileExists = false;
          }

          let result;
          if (fileExists) {
            // Update existing file
            result = await gitlab.updateFile(
              projectId,
              file.path,
              file.content,
              `${commitMessage} - Update ${file.path}`,
              branch,
            );
          } else {
            // Create new file
            result = await gitlab.createFile(
              projectId,
              file.path,
              file.content,
              `${commitMessage} - Create ${file.path}`,
              branch,
            );
          }

          results.push({
            path: file.path,
            status: fileExists ? "updated" : "created",
            commit_id: (result as any)?.commit_id || "unknown",
          });
        } catch (fileError) {
          console.error(`Error processing file ${file.path}:`, fileError);
          results.push({
            path: file.path,
            status: "error",
            error:
              fileError instanceof Error
                ? fileError.message
                : String(fileError),
          });
        }
      }

      const successCount = results.filter((r) => r.status !== "error").length;
      const errorCount = results.filter((r) => r.status === "error").length;

      return {
        content: [
          {
            type: "text",
            text: `Successfully processed ${successCount} file(s) on branch ${branch}. ${errorCount > 0 ? `${errorCount} error(s) occurred.` : ""}\n\nResults:\n${results.map((r) => `- ${r.path}: ${r.status}${r.error ? ` (${r.error})` : ""}`).join("\n")}`,
          },
        ],
        files_written: successCount,
        errors: errorCount,
        branch: branch,
        project_id: projectId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error in write_files_to_branch:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error writing files to GitLab branch: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

server.tool(
  "read_file_from_repo",
  "Read a file from the GitLab repository",
  {
    path: z.string().describe("Path to the file in the repository"),
    ref: z
      .string()
      .optional()
      .describe("Git reference (branch, tag, or commit SHA) to read from"),
  },
  async ({ path, ref }) => {
    try {
      const gitlabToken = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN;
      if (!gitlabToken) {
        throw new Error("GitLab token environment variable is required");
      }

      const gitlab = createGitLabClient(gitlabToken, GITLAB_API_URL);
      const projectId = PROJECT_ID;
      const gitRef = ref || BRANCH_NAME || "main";

      const file = (await gitlab.getFile(projectId, path, gitRef)) as any;

      if (file && "content" in file && "encoding" in file) {
        let content = file.content;

        // Decode base64 if needed
        if (file.encoding === "base64") {
          content = Buffer.from(content as string, "base64").toString("utf-8");
        }

        return {
          content: [
            {
              type: "text",
              text: `File content from ${path} (ref: ${gitRef}):\n\n${content}`,
            },
          ],
          file_path: path,
          ref: gitRef,
          size: (content as string).length,
        };
      } else {
        throw new Error("Unexpected file format from GitLab API");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error reading file from GitLab repository: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

server.tool(
  "create_merge_request",
  "Create a merge request in GitLab",
  {
    sourceBranch: z.string().describe("Source branch name"),
    targetBranch: z.string().describe("Target branch name"),
    title: z.string().describe("Merge request title"),
    description: z.string().optional().describe("Merge request description"),
  },
  async ({ sourceBranch, targetBranch, title, description }) => {
    try {
      const gitlabToken = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN;
      if (!gitlabToken) {
        throw new Error("GitLab token environment variable is required");
      }

      const projectId = PROJECT_ID;

      // Create merge request using direct API call since our simple client doesn't have this method
      const response = await fetch(
        `${GITLAB_API_URL}/projects/${projectId}/merge_requests`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gitlabToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source_branch: sourceBranch,
            target_branch: targetBranch,
            title: title,
            description: description || "",
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to create merge request: ${response.status} ${response.statusText}\n${errorText}`,
        );
      }

      const mr = (await response.json()) as any;

      return {
        content: [
          {
            type: "text",
            text: `Successfully created merge request: ${title}\nURL: ${mr.web_url}\nIID: ${mr.iid}`,
          },
        ],
        merge_request_iid: mr.iid,
        merge_request_url: mr.web_url,
        source_branch: sourceBranch,
        target_branch: targetBranch,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error creating merge request: ${errorMessage}`,
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
