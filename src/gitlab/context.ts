// GitLab CI context parsing and types
// Similar to GitHub context but for GitLab CI environment

// GitLab CI event types based on environment variables
export type GitLabMergeRequestEvent = {
  action: "opened" | "updated" | "closed" | "merged";
  project: {
    id: number;
    path: string;
    path_with_namespace: string;
  };
  merge_request: {
    iid: number;
    title: string;
    description?: string;
    state: string;
    source_branch: string;
    target_branch: string;
    author: {
      username: string;
      name: string;
    };
  };
  user?: {
    username: string;
    name: string;
  };
};

export type GitLabIssueEvent = {
  action: "opened" | "updated" | "closed" | "assigned";
  project: {
    id: number;
    path: string;
    path_with_namespace: string;
  };
  issue: {
    iid: number;
    title: string;
    description?: string;
    state: string;
    author: {
      username: string;
      name: string;
    };
    assignees?: Array<{
      username: string;
      name: string;
    }>;
  };
  user?: {
    username: string;
    name: string;
  };
};

export type GitLabPipelineEvent = {
  action: "manual" | "scheduled" | "api";
  project: {
    id: number;
    path: string;
    path_with_namespace: string;
  };
  pipeline: {
    id: number;
    status: string;
    ref: string;
    source: string;
  };
  user?: {
    username: string;
    name: string;
  };
};

// Event name constants for GitLab CI
const GITLAB_ENTITY_EVENT_NAMES = [
  "merge_request",
  "issue",
  "note", // Comments on MRs/issues
] as const;

const GITLAB_AUTOMATION_EVENT_NAMES = [
  "pipeline",
  "manual",
  "scheduled",
  "api",
] as const;

// Derive types from constants
type GitLabEntityEventName = (typeof GITLAB_ENTITY_EVENT_NAMES)[number];
type GitLabAutomationEventName = (typeof GITLAB_AUTOMATION_EVENT_NAMES)[number];

// Common fields shared by all GitLab context types
type BaseGitLabContext = {
  pipelineId: string;
  jobId: string;
  eventAction?: string;
  project: {
    id: string;
    path: string;
    full_path: string;
  };
  actor: string;
  inputs: {
    prompt: string;
    triggerPhrase: string;
    assigneeTrigger: string;
    labelTrigger: string;
    baseBranch?: string;
    branchPrefix: string;
    useStickyComment: boolean;
    useCommitSigning: boolean;
    botName: string;
    allowedBots: string;
    allowedNonWriteUsers: string;
    trackProgress: boolean;
  };
};

// Entity-based events (MRs, issues, comments)
export type GitLabEntityContext = BaseGitLabContext & {
  eventName: GitLabEntityEventName;
  payload: GitLabMergeRequestEvent | GitLabIssueEvent;
  entityNumber: number; // MR IID or Issue IID
  isMR: boolean; // true for MR, false for issue
};

// Automation events (pipelines, manual triggers)
export type GitLabAutomationContext = BaseGitLabContext & {
  eventName: GitLabAutomationEventName;
  payload: GitLabPipelineEvent;
};

// Union type for all GitLab contexts
export type GitLabContext = GitLabEntityContext | GitLabAutomationContext;

// Type guards
export function isEntityContext(
  context: GitLabContext,
): context is GitLabEntityContext {
  return GITLAB_ENTITY_EVENT_NAMES.includes(
    context.eventName as GitLabEntityEventName,
  );
}

export function isAutomationContext(
  context: GitLabContext,
): context is GitLabAutomationContext {
  return GITLAB_AUTOMATION_EVENT_NAMES.includes(
    context.eventName as GitLabAutomationEventName,
  );
}

// Default bot configuration for GitLab
const CLAUDE_GITLAB_BOT_USERNAME = "claude[bot]";

export function parseGitLabContext(): GitLabContext {
  const commonFields = {
    pipelineId: process.env.CI_PIPELINE_ID!,
    jobId: process.env.CI_JOB_ID!,
    eventAction: process.env.CI_PIPELINE_SOURCE,
    project: {
      id: process.env.CI_PROJECT_ID!,
      path: process.env.CI_PROJECT_NAME!,
      full_path: process.env.CI_PROJECT_PATH!,
    },
    actor:
      process.env.GITLAB_USER_LOGIN ||
      process.env.CI_COMMIT_AUTHOR ||
      "unknown",
    inputs: {
      prompt: process.env.PROMPT || process.env.CLAUDE_PROMPT || "",
      triggerPhrase: process.env.TRIGGER_PHRASE ?? "@claude",
      assigneeTrigger: process.env.ASSIGNEE_TRIGGER ?? "",
      labelTrigger: process.env.LABEL_TRIGGER ?? "claude",
      baseBranch: process.env.BASE_BRANCH || process.env.CI_DEFAULT_BRANCH,
      branchPrefix: process.env.BRANCH_PREFIX ?? "claude/",
      useStickyComment: process.env.USE_STICKY_COMMENT === "true",
      useCommitSigning: process.env.USE_COMMIT_SIGNING === "true",
      botName: process.env.BOT_NAME ?? CLAUDE_GITLAB_BOT_USERNAME,
      allowedBots: process.env.ALLOWED_BOTS ?? "",
      allowedNonWriteUsers: process.env.ALLOWED_NON_WRITE_USERS ?? "",
      trackProgress: process.env.TRACK_PROGRESS === "true",
    },
  };

  // Determine event type based on GitLab CI environment variables
  if (process.env.CI_MERGE_REQUEST_IID) {
    // Merge Request event
    const payload: GitLabMergeRequestEvent = {
      action: "opened", // Default action, would need webhook data for precise action
      project: {
        id: parseInt(process.env.CI_PROJECT_ID!),
        path: process.env.CI_PROJECT_NAME!,
        path_with_namespace: process.env.CI_PROJECT_PATH!,
      },
      merge_request: {
        iid: parseInt(process.env.CI_MERGE_REQUEST_IID!),
        title: process.env.CI_MERGE_REQUEST_TITLE || "",
        description: process.env.CI_MERGE_REQUEST_DESCRIPTION,
        state: "opened",
        source_branch: process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME!,
        target_branch: process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME!,
        author: {
          username: process.env.GITLAB_USER_LOGIN || "unknown",
          name: process.env.GITLAB_USER_NAME || "Unknown User",
        },
      },
    };

    return {
      ...commonFields,
      eventName: "merge_request",
      payload,
      entityNumber: parseInt(process.env.CI_MERGE_REQUEST_IID!),
      isMR: true,
    };
  } else if (process.env.GITLAB_ISSUE_IID) {
    // Issue event (custom environment variable)
    const payload: GitLabIssueEvent = {
      action: "opened",
      project: {
        id: parseInt(process.env.CI_PROJECT_ID!),
        path: process.env.CI_PROJECT_NAME!,
        path_with_namespace: process.env.CI_PROJECT_PATH!,
      },
      issue: {
        iid: parseInt(process.env.GITLAB_ISSUE_IID!),
        title: process.env.GITLAB_ISSUE_TITLE || "",
        description: process.env.GITLAB_ISSUE_DESCRIPTION,
        state: "opened",
        author: {
          username: process.env.GITLAB_USER_LOGIN || "unknown",
          name: process.env.GITLAB_USER_NAME || "Unknown User",
        },
      },
    };

    return {
      ...commonFields,
      eventName: "issue",
      payload,
      entityNumber: parseInt(process.env.GITLAB_ISSUE_IID!),
      isMR: false,
    };
  } else {
    // Automation event (pipeline, manual trigger, etc.)
    const payload: GitLabPipelineEvent = {
      action: (process.env.CI_PIPELINE_SOURCE as any) || "manual",
      project: {
        id: parseInt(process.env.CI_PROJECT_ID!),
        path: process.env.CI_PROJECT_NAME!,
        path_with_namespace: process.env.CI_PROJECT_PATH!,
      },
      pipeline: {
        id: parseInt(process.env.CI_PIPELINE_ID!),
        status: process.env.CI_PIPELINE_STATUS || "running",
        ref: process.env.CI_COMMIT_REF_NAME!,
        source: process.env.CI_PIPELINE_SOURCE!,
      },
    };

    return {
      ...commonFields,
      eventName:
        (process.env.CI_PIPELINE_SOURCE as GitLabAutomationEventName) ||
        "manual",
      payload,
    };
  }
}

// Utility function to detect if we're running in GitLab CI
export function isGitLabCI(): boolean {
  return (
    process.env.GITLAB_CI === "true" || process.env.GITLAB_CI_MODE === "true"
  );
}
