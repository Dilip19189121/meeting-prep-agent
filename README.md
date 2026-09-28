# Meeting Prep Agent

An AI agent that remembers every past meeting with each contact and briefs you before the next one. It uses [Hindsight](https://github.com/vectorize-io/hindsight) for persistent agent memory.

## The Problem

Before a meeting, I used to re-read old notes and still forget what I promised. A normal AI assistant has no memory of past meetings, so its briefs are generic.

## What It Does

- Stores notes from every meeting with each contact
- Recalls past discussions, promises, and concerns before the next meeting
- Generates a brief: what was discussed, what I promised, and what is still open
- Gets better with each new meeting I add

## Example

**Without memory:** "Prepare an agenda, review the goals, and be ready for questions."

**With memory:** "You promised Priya a revised pricing proposal. She was worried about the timeline. The security review is still open."

## How Hindsight Memory Is Used

1. **Retain:** Each meeting note is saved to a Hindsight memory bank with `retain`.
2. **Recall:** Before a meeting, the agent calls `recall` with the contact's name to fetch relevant past context.
3. **Brief:** The recalled memories are passed to the LLM (Groq), which writes the brief.
4. **Improve:** Every new note is retained, so the next brief is more accurate and personal.

The app includes a **Memory ON / OFF** toggle to show the difference.

## Tech Stack

- Hindsight Cloud (agent memory)
- Groq API, `openai/gpt-oss-120b` (LLM)
- Python
- Streamlit (UI)

## Project Structure

```
meeting-prep-agent/
├── app.py            # Streamlit UI
├── agent.py          # Recall + brief generation
├── load_data.py      # Loads sample meetings into Hindsight
├── data/
│   └── meetings.json # Synthetic meeting notes
├── .env              # API keys (not committed)
└── README.md
```

## Setup

1. Clone the repo:
```bash
   git clone https://github.com/YOUR-USERNAME/meeting-prep-agent.git
   cd meeting-prep-agent
```
2. Install dependencies:
```bash
   pip install hindsight-client groq streamlit python-dotenv
```
3. Create a `.env` file:
```
   HINDSIGHT_API_KEY=your_hindsight_key
   GROQ_API_KEY=your_groq_key
```
4. Load the sample data into memory:
```bash
   python load_data.py
```
5. Run the app:
```bash
   streamlit run app.py
```

## Usage

1. Pick a contact from the dropdown.
2. Click **Prep me** to get a brief based on past meetings.
3. Add new meeting notes in the box. They are saved to memory.
4. Click **Prep me** again and see the brief improve.

## Sample Data

The meetings in `data/meetings.json` are synthetic, generated with an LLM to look like real business meetings.

