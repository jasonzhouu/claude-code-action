import fetch from "node-fetch";
import { GITLAB_API_URL } from "./config";

export class GitLabClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = baseUrl || GITLAB_API_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitLab API request failed: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  // Project operations
  async getProject(projectId: string | number) {
    return this.request(`/projects/${projectId}`);
  }

  // Merge Request operations
  async getMergeRequest(projectId: string | number, mergeRequestIid: number) {
    return this.request(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}`,
    );
  }

  async createMergeRequestNote(
    projectId: string | number,
    mergeRequestIid: number,
    body: string,
  ) {
    return this.request(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
  }

  async updateMergeRequestNote(
    projectId: string | number,
    mergeRequestIid: number,
    noteId: number,
    body: string,
  ) {
    return this.request(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/notes/${noteId}`,
      {
        method: "PUT",
        body: JSON.stringify({ body }),
      },
    );
  }

  // Issue operations
  async getIssue(projectId: string | number, issueIid: number) {
    return this.request(`/projects/${projectId}/issues/${issueIid}`);
  }

  async createIssueNote(
    projectId: string | number,
    issueIid: number,
    body: string,
  ) {
    return this.request(`/projects/${projectId}/issues/${issueIid}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async updateIssueNote(
    projectId: string | number,
    issueIid: number,
    noteId: number,
    body: string,
  ) {
    return this.request(
      `/projects/${projectId}/issues/${issueIid}/notes/${noteId}`,
      {
        method: "PUT",
        body: JSON.stringify({ body }),
      },
    );
  }

  // File operations
  async getFile(
    projectId: string | number,
    filePath: string,
    ref: string = "main",
  ) {
    const encodedPath = encodeURIComponent(filePath);
    return this.request(
      `/projects/${projectId}/repository/files/${encodedPath}?ref=${ref}`,
    );
  }

  async createFile(
    projectId: string | number,
    filePath: string,
    content: string,
    commitMessage: string,
    branch: string = "main",
  ) {
    const encodedPath = encodeURIComponent(filePath);
    return this.request(
      `/projects/${projectId}/repository/files/${encodedPath}`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          commit_message: commitMessage,
          branch,
          encoding: "text",
        }),
      },
    );
  }

  async updateFile(
    projectId: string | number,
    filePath: string,
    content: string,
    commitMessage: string,
    branch: string = "main",
  ) {
    const encodedPath = encodeURIComponent(filePath);
    return this.request(
      `/projects/${projectId}/repository/files/${encodedPath}`,
      {
        method: "PUT",
        body: JSON.stringify({
          content,
          commit_message: commitMessage,
          branch,
          encoding: "text",
        }),
      },
    );
  }

  // Branch operations
  async getBranch(projectId: string | number, branchName: string) {
    return this.request(
      `/projects/${projectId}/repository/branches/${branchName}`,
    );
  }

  async createBranch(
    projectId: string | number,
    branchName: string,
    ref: string = "main",
  ) {
    return this.request(`/projects/${projectId}/repository/branches`, {
      method: "POST",
      body: JSON.stringify({
        branch: branchName,
        ref,
      }),
    });
  }

  // Pipeline operations
  async getPipeline(projectId: string | number, pipelineId: number) {
    return this.request(`/projects/${projectId}/pipelines/${pipelineId}`);
  }

  async getJob(projectId: string | number, jobId: number) {
    return this.request(`/projects/${projectId}/jobs/${jobId}`);
  }
}

export function createGitLabClient(
  token: string,
  baseUrl?: string,
): GitLabClient {
  return new GitLabClient(token, baseUrl);
}
