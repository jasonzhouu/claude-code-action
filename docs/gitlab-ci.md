# GitLab CI Integration

This document explains how to use the Claude Code Action with GitLab CI instead of GitHub Actions.

## Overview

The Claude Code Action has been extended to support GitLab CI environments. It can automatically detect when running in GitLab CI and adapt its behavior accordingly.

## Setup

### 1. Add GitLab CI Configuration

Create a `.gitlab-ci.yml` file in your repository root:

```yaml
# GitLab CI configuration for Claude Code Action
stages:
  - prepare
  - execute
  - cleanup

variables:
  TRIGGER_PHRASE: "@claude"
  LABEL_TRIGGER: "claude"
  BRANCH_PREFIX: "claude/"
  USE_STICKY_COMMENT: "false"
  USE_COMMIT_SIGNING: "false"
  BOT_NAME: "claude[bot]"
  TRACK_PROGRESS: "false"
  BUN_VERSION: "1.2.11"

# Template for common setup steps
.setup_template: &setup_template
  image: ubuntu:22.04
  before_script:
    - apt-get update -qq && apt-get install -y -qq curl unzip git
    # Install Bun
    - curl -fsSL https://bun.sh/install | bash
    - export PATH="$HOME/.bun/bin:$PATH"
    # Clone the claude-code-action repository
    - git clone https://github.com/jasonzhouu/claude-code-action.git /tmp/claude-code-action
    - cd /tmp/claude-code-action
    - bun install
    # Install Claude Code CLI
    - curl -fsSL https://claude.ai/install.sh | bash -s 1.0.120
    - export PATH="$HOME/.local/bin:$PATH"

# Execute Claude Code
execute_claude:
  <<: *setup_template
  stage: execute
  script:
    - export PATH="$HOME/.bun/bin:$PATH"
    - export PATH="$HOME/.local/bin:$PATH"
    # Set GitLab-specific environment variables
    - export GITLAB_CI_MODE="true"
    - export PLATFORM="gitlab"
    - cd /tmp/claude-code-action
    # Run preparation logic
    - bun run src/entrypoints/prepare.ts
    # Run base-action equivalent if triggered
    - |
      if [ "$CONTAINS_TRIGGER" = "true" ]; then
        cd base-action && bun install && cd ..
        bun run base-action/src/index.ts
      fi
  only:
    variables:
      # Only run on merge request events, issue events, or manual triggers
      - $CI_MERGE_REQUEST_IID
      - $CLAUDE_MANUAL_TRIGGER

# Manual trigger job for testing
manual_claude_trigger:
  <<: *setup_template
  stage: execute
  script:
    - export PATH="$HOME/.bun/bin:$PATH"
    - export PATH="$HOME/.local/bin:$PATH"
    - export GITLAB_CI_MODE="true"
    - export PLATFORM="gitlab"
    - export CLAUDE_MANUAL_TRIGGER="true"
    # Use provided prompt or default
    - export PROMPT="${CLAUDE_PROMPT:-Please review this repository and provide suggestions for improvement.}"
    - cd /tmp/claude-code-action
    # Run the full pipeline
    - bun run src/entrypoints/prepare.ts
    - cd base-action && bun install && cd ..
    - bun run base-action/src/index.ts
  when: manual
  allow_failure: true
```

### 2. Set Up Environment Variables

In your GitLab project, go to Settings > CI/CD > Variables and add:

#### Required Variables

- `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude access
- `GITLAB_TOKEN`: GitLab access token (or use CI_JOB_TOKEN if permissions allow)

#### Optional Variables

- `CLAUDE_PROMPT`: Custom prompt for manual triggers
- `TRIGGER_PHRASE`: Phrase to trigger Claude (default: "@claude")
- `USE_STICKY_COMMENT`: Whether to use sticky comments (default: "false")

### 3. Token Permissions

The GitLab token needs the following scopes:

- `api`: Full API access for reading/writing comments, files, etc.
- `read_repository`: Access to repository content
- `write_repository`: Ability to create branches and commits

Alternatively, you can use the CI_JOB_TOKEN if it has sufficient permissions for your use case.

## Usage

### Merge Request Reviews

When a merge request is created or updated, you can trigger Claude by:

1. **Manual Trigger**: Use the manual job in GitLab CI pipelines
2. **Environment Variables**: Set `CLAUDE_MANUAL_TRIGGER=true` to run on MR events

### Issue Management

For issue management, set the `GITLAB_ISSUE_IID` environment variable to the issue IID.

### Custom Prompts

You can customize Claude's behavior by setting environment variables:

```yaml
variables:
  CLAUDE_PROMPT: |
    Please review this merge request for:
    1. Code quality and best practices
    2. Security vulnerabilities
    3. Performance implications
    4. Documentation completeness
```

## Platform Differences

### GitLab CI vs GitHub Actions

| Feature         | GitHub Actions      | GitLab CI             |
| --------------- | ------------------- | --------------------- |
| Event Detection | Webhook events      | Environment variables |
| Authentication  | GitHub App / OIDC   | GitLab tokens         |
| API             | GitHub REST/GraphQL | GitLab REST API       |
| File Operations | GitHub Git API      | GitLab Repository API |
| Comments        | Issue/PR comments   | MR/Issue notes        |

### Supported Features in GitLab CI

- ✅ Merge request comments
- ✅ Issue comments
- ✅ File operations (read/write)
- ✅ Branch creation
- ✅ Merge request creation
- ✅ Manual triggers
- ✅ Custom prompts
- ❌ GitLab CI pipeline integration (not yet implemented)
- ❌ Inline MR comments (not yet implemented)

## Environment Variables

The following environment variables are automatically available in GitLab CI:

### GitLab CI Variables

- `GITLAB_CI`: Set to "true" in GitLab CI
- `CI_PROJECT_ID`: Project ID
- `CI_PROJECT_PATH`: Project path (owner/repo)
- `CI_MERGE_REQUEST_IID`: Merge request IID (if applicable)
- `CI_PIPELINE_ID`: Current pipeline ID
- `CI_JOB_ID`: Current job ID
- `CI_JOB_TOKEN`: GitLab CI job token

### Custom Variables

- `GITLAB_CI_MODE`: Set to "true" to force GitLab mode
- `GITLAB_TOKEN`: GitLab access token
- `GITLAB_PROJECT_ID`: Override project ID
- `GITLAB_ISSUE_IID`: Issue IID for issue operations
- `CLAUDE_MANUAL_TRIGGER`: Set to "true" for manual execution

## Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure your GitLab token has `api` scope
2. **Project Not Found**: Verify `CI_PROJECT_ID` and token permissions
3. **Module Not Found**: Make sure Bun installation completed successfully
4. **API Rate Limits**: GitLab has API rate limits; consider adding delays for large operations

### Debug Mode

Enable debug logging by setting:

```yaml
variables:
  DEBUG: "true"
  VERBOSE: "true"
```

## Examples

### Basic MR Review

```yaml
claude_review:
  image: ubuntu:22.04
  script:
    -  # Setup steps from template
    - export CLAUDE_PROMPT="Please review this merge request for code quality and security issues."
    - bun run /tmp/claude-code-action/src/entrypoints/prepare.ts
  only:
    - merge_requests
```

### Scheduled Code Analysis

```yaml
claude_analysis:
  image: ubuntu:22.04
  script:
    -  # Setup steps from template
    - export CLAUDE_PROMPT="Analyze the repository for technical debt and improvement opportunities."
    - bun run /tmp/claude-code-action/src/entrypoints/prepare.ts
  schedule:
    - cron: "0 9 * * 1" # Every Monday at 9 AM
```

## Migration from GitHub Actions

If you're migrating from GitHub Actions:

1. Replace `action.yml` workflow with `.gitlab-ci.yml`
2. Update environment variable names (see table above)
3. Replace GitHub-specific references with GitLab equivalents
4. Test authentication with GitLab tokens
5. Verify webhook/trigger configuration

## Contributing

To contribute GitLab CI improvements:

1. Ensure changes work in both GitHub Actions and GitLab CI
2. Add tests for GitLab-specific functionality
3. Update documentation for new features
4. Follow the existing code patterns for platform abstraction
