# Linear Ops — Human Interface Layer for Linear

## Summary

Linear Ops turns Linear into a **clear, navigable “work dashboard” for non-technical humans**, while keeping the full power of Linear underneath.

It is:

- **A graphical UI for Issues, Projects, and Roadmaps** (with plain-English lenses and explanations), and
- **A safe communication layer to Linear** that proposes changes as explicit plans, then executes only on approval.

Linear remains the **database and source of truth**. Linear Ops makes that truth understandable, auditable, and easy to act on.

---

## The Problem

Linear is excellent for teams that already speak “Linear”:

- workflow states, cycles, label groups, identifiers, triage etiquette, etc.

But for many people (ops, founders, PMs, stakeholders, non-technical teammates), it can feel like:

- too many concepts,
- too many places to click,
- too much room for inconsistency,
- and too risky to automate.

Real-world pain:

- People can’t quickly answer “What’s happening right now?” without learning the system.
- Work gets created inconsistently (missing fields, wrong tags, unclear descriptions).
- Turning PRDs/briefs into structured work is manual and error-prone.
- “AI automation” is scary when it makes changes invisibly or without guardrails.

---

## The Solution

Linear Ops makes Linear usable as a **human-readable operating system for work**.

### 1) Explore (Read-first, truth-first)

A clean UI that helps anyone understand what’s going on in Linear:

- “What’s active now?”
- “What’s waiting for review?”
- “What’s blocked?”
- “What changed since yesterday?”
- “Are we on track for this project?”

It presents Linear data using:

- **Plain-language terms** (e.g., “Tasks”, “Stage”, “This week”),
- **Friendly lenses** (Active, Blocked, Done recently),
- **Clear explanations** of why items are where they are,
while always linking back to Linear for verification.

### 2) Translate intent into safe operations (Plan → Review → Execute)

Users can request changes in natural language:

- “Move these tasks to review”
- “Create a project plan from this doc”
- “Assign these to Alfred”
- “Split this work into milestones”

The app converts intent into a **single, explicit Linear action plan**:

- A structured `{ action, payload }` operation
- Using **IDs and validated options** derived from team metadata
- Displayed as a **human-readable change summary** (with optional raw JSON)

Nothing is executed until the user approves.

### 3) Import documents into clean, structured work

Upload `.md` / `.json` PRDs, briefs, or templates and get:

- One actionable plan per file
- A review queue of pending actions
- Batch approval and execution

---

## What This Product Aims to Be

**A “Linear for humans” layer**:

- For teams that want Linear to remain the system of record,
- But need a friendlier interface to browse, understand, and safely operate it.

It should feel like:

- Notion-level readability
- With Stripe-level safety and auditability
- Built on top of Linear’s data model

---

## Target Users

- **Non-technical stakeholders** who need clarity without learning “Linear-speak”
- **PMs and engineering leads** who create/triage lots of work and want consistency
- **Operators/support roles** converting intake docs into structured Linear work
- **Engineers** who want faster, safer issue/project maintenance

---

## Core Workflows

### A) Choose a team (and load its “playbook”)

- Select the target Linear team
- The system fetches team metadata (projects, cycles, labels, workflow states)
- The UI presents this as a **Team Playbook**:
  - Stages (what they mean)
  - Tag categories (label groups) and allowed values
  - Priority meanings
  - Common lenses (Active, Blocked, Done recently)

### B) Explore → Verify

- Browse Issues/Projects/Roadmaps through lenses and dashboards
- Every item has a “View in Linear” link
- Counts/states must match Linear exactly (trust is sacred)

### C) Ask → Plan → Review → Execute

- User asks for an operation in plain English
- The server returns one proposed action plan
- The Action Inspector shows:
  - **Human-readable summary of changes**
  - Exact `{ action, payload }` (Advanced)
- User approves/declines
- The server executes against Linear

### D) Upload → Batch Plan → Review → Execute

- Upload files (PRDs, templates, briefs)
- The server extracts one action per file
- The UI queues planned actions
- Execute as a batch or individually after review

---

## Key Principles

- **Truth-first**: the UI must not contradict Linear.
- **Read-first**: browsing is safe; changes are explicit and reviewable.
- **Plan-first safety**: no hidden execution, no silent automation.
- **ID-first enforcement**: prefer IDs over names when metadata is available.
- **Metadata-driven correctness**: workflow logic uses workflow state *types* and team metadata, not hard-coded names.
- **Explainability**: every action and every list should answer “why am I seeing this?”

---

## Key Capabilities

### Implemented

- Plan-first safety (approval required)
- Team-aware metadata fetch and “allowed options” context
- ID enforcement & normalization:
  - Prefer IDs when available
  - Enforce label-group exclusivity (one child per group)
  - Normalize priority into Linear numeric scheme (`0..4`)
  - Clean descriptions (remove redundant title headers)
- Batch planning & execution from file uploads
- Mock mode for development and testing

### Next to Strengthen (to match the vision)

- A first-class **Explorer UI** (Work/Projects/Roadmap) with plain-English lenses
- Human-readable diffs in Action Inspector (raw JSON as Advanced)
- “What changed?” activity views powered by read-only queries
- A shareable “Team Playbook” view generated from metadata

---

## Supported Operations (Execution Layer)

### Mutations

- Issues: `createIssue`, `updateIssue`, `deleteIssue`
- Projects: `createProject`, `updateProject`, `readProject`
- Roadmaps: `createRoadmap`, `readRoadmap`

### Read Operations

- Read/list/search operations may be supported as explicit `{ action, payload }` plans,
  enabling non-technical exploration through the same reviewable mechanism.

---

## Architecture (High Level)

### Client

- Explorer UI for Issues/Projects/Roadmaps
- Chat UI for intent
- File uploader for batch ingestion
- Action Inspector for plan review/approval
- Settings for API keys and team selection

### Server

- `/api/agent`: converts user intent into a single `{ action, payload }` plan
- `/api/upload`: extracts one action per file, resolves names → IDs using metadata
- `/api/execute`: executes approved action(s) via `@linear/sdk` (single or batch)
- Metadata cache: teams, projects, cycles, labels, workflow states

---

## Security & Data Handling (Current Model)

- API keys are provided by the user and stored client-side
- Requests forward keys to the server via headers
- The server does not persist keys
- No database is required for core functionality; state is primarily UI state plus short-lived caches

---

## Current Limitations

- One action per chat request (no multi-step orchestration)
- “One action per file” in batch ingestion (complex docs should be split)
- UX still needs to fully embody “Linear for humans” (Explorer, lenses, diffs)
