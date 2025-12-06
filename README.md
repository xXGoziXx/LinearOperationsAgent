# AI Linear Operations Agent

A production-ready web application that allows users to interact with Linear using natural language and file uploads. Built with React (Vite) and Node.js (Express).

## Features

- **Natural Language Chat**: Create, update, and query Linear issues, projects, and roadmaps.
- **File Upload**: Drag & drop JSON or Markdown files into the UI to bulk-create issues.
- **AI-Powered**: Uses OpenAI to interpret user intent and structure Linear API calls.
- **Live Action Inspector**: See exactly what the AI agent is sending to the Linear API.
- **Modern UI**: Full dark-mode interface with glassmorphism aesthetics.

## Prerequisites

- Node.js (v18+)
- Linear API Key
- OpenAI API Key

## Setup

1. **Clone & Install Dependencies**
   ```bash
   # Install root/client/server dependencies
   cd server && npm install
   cd ../client && npm install
   ```

2. **Configure Environment**
   Create a `.env` file in `server/` (or root if running together, but server reads it):
   ```bash
   cp .env.example server/.env
   ```
   Edit `server/.env` and add your keys:
   ```env
   LINEAR_API_KEY=lin_api_...
   OPENAI_API_KEY=sk-...
   ```

3. **Run the Application**

   **Backend:**
   ```bash
   cd server
   npm run dev
   # Runs on http://localhost:3000
   ```

   **Frontend:**
   ```bash
   cd client
   npm run dev
   # Runs on http://localhost:5173
   ```

4. **Verify**
   Open the frontend URL. You should see the Chat Interface.

## Usage

- **Create an Issue**: Type "Create a high priority bug for the Mobile App project regarding crash on login."
- **Upload Issues**: Drag a `.md` file with issue details into the upload area.
- **View Actions**: Watch the panel on the right to see the executed Linear mutations.

## Architecture

- **Client**: React, Typescript, Vite, Tailwind CSS, Lucide Icons.
- **Server**: Express, Typescript, OpenAI SDK, @linear/sdk.
- **Agent**: Server-side logic classifies intent and generates structured payloads.
