# Linear Ops Agent — Product Overview

## Summary

Linear Ops Agent is a local web app that turns natural-language requests (and uploaded Markdown/JSON files) into explicit, reviewable Linear operations. It helps teams create and update issues/projects faster while keeping the workflow safe via a “plan first, execute on approval” model.

## Problem

- Creating well-formed issues/projects in Linear is repetitive and easy to get inconsistent (missing fields, wrong labels, unclear descriptions).
- Bulk-importing work from PRDs/briefs often requires manual copy/paste and cleanup.
- “AI automation” is risky when it executes changes invisibly or without guardrails.

## Solution

- A chat-driven agent that converts user intent into a single, structured Linear action payload.
- A file-ingestion pipeline that extracts one actionable item per uploaded file and produces a batch plan.
- A live Action Inspector that shows the exact action/payload and requires explicit user approval before calling Linear.

## Target Users

- Product managers and engineering leads who create and triage large amounts of work.
- Engineers who want faster issue maintenance (updates, cleanup, project assignment).
- Operators/support roles who convert intake documents into actionable Linear items.

## Core Workflows

1. **Configure keys & pick a team**
   - Enter `LINEAR_API_KEY` and `OPENAI_API_KEY` in Settings (stored in the browser) and select the target team.
2. **Chat → Plan → Review → Execute**
   - Ask for an operation in natural language.
   - The server returns a proposed Linear action and payload.
   - Review and accept/decline in the Action Inspector.
3. **Upload files → Batch plan → Review → Execute**
   - Upload `.md` / `.json` files (e.g., PRDs or issue templates).
   - The server returns a list of planned actions (one per file).
   - Execute all pending actions at once or approve/decline individually.

## Key Capabilities (What’s Implemented)

- **Plan-first safety**: the agent generates a plan; execution only happens after user approval.
- **Team-aware context**: the server fetches team metadata (projects, cycles, labels, workflow states) and provides it as “allowed options” to the model.
- **ID enforcement & normalization**
  - Prefer IDs (projectId/labelIds/stateId/etc.) rather than names when metadata is available.
  - Enforces Linear label-group exclusivity (prevents multiple child labels from the same group).
  - Normalizes priority into Linear’s numeric scheme (`0..4`) and supports common `P0..P3` mappings.
  - Removes redundant title headers from descriptions (keeps issues clean when templates start with `# Title`).
- **Batch planning & execution**: multiple uploaded files become a queue of pending actions; execute as a batch or individually.
- **Mock mode for development**: if a valid Linear key is not available, the backend can return mocked teams/metadata/results so the UI can be exercised.

## Supported Operations (Backend Execution Layer)

The server supports executing these Linear operations:

- Issues: `createIssue`, `updateIssue`, `deleteIssue`
- Projects: `createProject`, `updateProject`, `readProject`
- Roadmaps: `createRoadmap`, `readRoadmap`

Note: The agent prompts currently focus on issue/project creation and updates; additional actions are supported by the execution endpoint when provided by a plan.

## How It Works (High Level)

- **Client (React/Vite)**
  - Chat UI for natural language input.
  - File uploader for `.md`/`.json` batch ingestion.
  - Action Inspector for reviewing and approving planned actions.
  - Settings modal stores API keys in browser localStorage and sends them to the server via request headers.
- **Server (Express/TypeScript)**
  - `/api/agent`: calls OpenAI to convert a user message into a single JSON `{ action, payload }` plan.
  - `/api/upload`: reads uploaded files, calls OpenAI to extract one action per file, then resolves helper fields (assignee/labels/project) into IDs using Linear metadata.
  - `/api/execute`: performs the approved action(s) against Linear via `@linear/sdk` (supports single or batch execution).

## Integrations & Dependencies

- **Linear**: `@linear/sdk` for metadata fetch and mutations.
- **OpenAI**: `openai` SDK for JSON-formatted action planning.
- **Frontend**: React + Tailwind UI with an inspector-driven approval flow.

## Security & Data Handling (Current Model)

- API keys are provided by the user and stored locally in the browser (localStorage).
- Requests forward keys to the local server via headers (the server does not persist them).
- There is no database; the app is effectively stateless beyond client-side UI state and short-lived server-side caches.

## Current Limitations

- The “agent” produces a single action per chat request (no multi-step plans across multiple Linear mutations).
- File upload extraction is “one action per file” by design; complex docs may need to be split into separate files for best results.
- No user authentication/authorization beyond possession of the API keys (intended for local/dev use).
