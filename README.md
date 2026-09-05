# CampusOS — AI Build Hackathon

## Project Overview
CampusOS is a university campus management platform with a data dashboard and an AI assistant. The dashboard manages schedules, rooms, events, announcements, and assignments. The AI agent answers questions and performs actions using live data from the database.

## Tech Stack
- Backend: Node.js + Express 5
- Database: SQLite with better-sqlite3
- AI: Google Gemini API (function calling)
- Frontend: HTML, CSS, JavaScript

## Setup Instructions

### Prerequisites
- Node.js 20 or newer
- npm
- Gemini API key (optional - dashboard works without it)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/cse-carnival-8-aibuild-hackathon.git
cd cse-carnival-8-aibuild-hackathon

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
```

Edit `.env` and add your Gemini API key:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

### Seed the Database
```bash
npm run seed
```

### Start the Application
```bash
npm start
```

Open http://localhost:3000 in your browser.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| GEMINI_API_KEY | AI only | none | Enables the AI assistant |
| PORT | No | 3000 | Server port |
| DATABASE_PATH | No | campus.db | SQLite file path |
| CAMPUS_TIMEZONE | No | Asia/Dhaka | Timezone for the agent |
| DEMO_STUDENT_ID | No | 20-40532 | Student ID for actions |
| DEMO_STUDENT_NAME | No | Dr. Doom | Student name for actions |

Never commit `.env` to the repository.

## How to Use the Agent

Open the AI Assistant from the sidebar and ask questions like:

- "When is my next class?"
- "What assignments are due this week?"
- "Show me all high priority announcements."
- "Book Room 7A02 tomorrow from 3 PM to 5 PM."
- "Register me for the Guest Lecture on Deep Learning."
- "I need a room for 5 people with a projector, tomorrow between 2 and 4."

The agent reads live data from the database. Any change made in the dashboard is immediately available to the agent.

---

## License

This project is licensed under the [MIT License](LICENSE).
