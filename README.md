# AI Linear Operations Agent

A production-ready web application that allows users to interact with Linear using natural language and file uploads. Built with Next.js (Pages Router), React, and TypeScript.

## Features

- **Natural Language Chat**: Create, update, and query Linear issues, projects, and roadmaps.
- **File Upload**: Drag & drop JSON or Markdown files into the UI to bulk-create issues.
- **AI-Powered**: Uses OpenAI to interpret user intent and structure Linear API calls.
- **Live Action Inspector**: See exactly what the AI agent is sending to the Linear API.
- **Modern UI**: Full dark-mode interface with glassmorphism aesthetics.

## Prerequisites

- Node.js (v18+)
- pnpm (v10+)
- Linear API Key
- OpenAI API Key

## Setup

1. **Install Dependencies**
   ```bash
   pnpm install
   ```

2. **Configure Environment**
   Create a `.env.local` file in the root directory:
   ```bash
   cp .env.local.example .env.local
   ```
   Edit `.env.local` and add your keys:
   ```env
   LINEAR_API_KEY=lin_api_...
   OPENAI_API_KEY=sk-...
   ```

   Note: API keys can also be set in the browser settings modal (stored in localStorage).

3. **Run the Application**
   ```bash
   pnpm dev
   # Runs on http://localhost:3000
   ```

4. **Build for Production**
   ```bash
   pnpm build
   pnpm start
   ```

## Usage

- **Create an Issue**: Type "Create a high priority bug for the Mobile App project regarding crash on login."
- **Upload Issues**: Drag a `.md` or `.json` file with issue details into the upload area.
- **View Actions**: Watch the panel on the right to see the executed Linear mutations.

## Architecture

- **Framework**: Next.js 15 with Pages Router
- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons
- **Backend**: Next.js API Routes, OpenAI SDK, @linear/sdk
- **Agent**: Server-side logic classifies intent and generates structured payloads

## Project Structure

```
├── pages/
│   ├── api/          # API route handlers
│   ├── _app.tsx      # Root app component
│   └── index.tsx     # Home page
├── components/       # React components
├── lib/             # Shared utilities and services
│   ├── agent.ts      # OpenAI agent logic
│   ├── linear.ts     # Linear SDK integration
│   ├── types.ts      # TypeScript types
│   └── api.ts        # API client
└── styles/          # Global styles
```
