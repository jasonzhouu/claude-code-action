/**
 * Main prepare module that delegates to the mode's prepare method
 */

import type { PrepareOptions, PrepareResult } from "./types";

export async function prepare(options: PrepareOptions): Promise<PrepareResult> {
  const { mode, context, octokit, githubToken, token, platform } = options;

  console.log(
    `Preparing with mode: ${mode.name} for event: ${context.eventName} on platform: ${platform || "github"}`,
  );

  // For now, delegate to the mode's prepare method with GitHub context
  // TODO: Add proper GitLab mode support
  return mode.prepare({
    context: context as any,
    octokit: octokit!,
    githubToken: githubToken || token || "",
  });
}
