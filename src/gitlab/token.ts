#!/usr/bin/env bun

import { retryWithBackoff } from "../utils/retry";

async function getGitLabToken(): Promise<string> {
  // Check for provided GitLab token in various environment variables
  const providedToken =
    process.env.GITLAB_TOKEN ||
    process.env.CI_JOB_TOKEN ||
    process.env.GITLAB_ACCESS_TOKEN ||
    process.env.GITLAB_PROJECT_ACCESS_TOKEN;

  if (providedToken) {
    console.log("Using provided GitLab token for authentication");
    return providedToken;
  }

  // For GitLab CI, we can use the CI_JOB_TOKEN
  if (process.env.GITLAB_CI === "true" && process.env.CI_JOB_TOKEN) {
    console.log("Using CI_JOB_TOKEN for GitLab authentication");
    return process.env.CI_JOB_TOKEN;
  }

  throw new Error(
    "No GitLab token found. Please provide one of the following environment variables:\n" +
      "- GITLAB_TOKEN (preferred for personal access tokens)\n" +
      "- GITLAB_ACCESS_TOKEN (alias for GITLAB_TOKEN)\n" +
      "- GITLAB_PROJECT_ACCESS_TOKEN (for project access tokens)\n" +
      "- CI_JOB_TOKEN (automatically available in GitLab CI)\n\n" +
      "For GitLab CI, make sure the job has appropriate permissions or provide a custom token.",
  );
}

export async function setupGitLabToken(): Promise<string> {
  try {
    const token = await retryWithBackoff(() => getGitLabToken());
    console.log("GitLab token successfully obtained");
    return token;
  } catch (error) {
    console.error(
      `Failed to setup GitLab token: ${error}\n\n` +
        `If you wish to use this action with a custom GitLab token, provide one of the following:\n` +
        `- GITLAB_TOKEN environment variable with a personal access token\n` +
        `- GITLAB_PROJECT_ACCESS_TOKEN with a project access token\n` +
        `- For GitLab CI: ensure CI_JOB_TOKEN has sufficient permissions`,
    );
    process.exit(1);
  }
}
