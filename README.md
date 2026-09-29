# Meeting Prep Agent

An AI agent that remembers every past meeting with each contact and briefs you before the next one. Built with [Hindsight Cloud](https://hindsight.vectorize.io/) for persistent agent memory and Groq for the LLM.

## The Problem

Before a meeting, I used to re-read old notes and still forget what I promised. A normal AI assistant has no memory of past meetings, so its briefs are generic.

## What It Does

- Stores notes from every meeting with each contact in a Hindsight memory bank
- Recalls past discussions, promises, concerns, and open items before the next meeting
- Generates a four-section prep brief: **What we discussed**, **What I promised**, **Still open**, **Talking points**
- Gets better with each new meeting note you save
- Includes a **Memory ON / OFF** toggle so you can see the difference memory makes

## Example

**Memory OFF (generic):**

> No notes available. — every section is generic because nothing was recalled.

**Memory ON (grounded):**

> What I promised: Send the SOC 2 report and encryption whitepaper (Mar 18 2026).
> Still open: Board presentation deck due Jun 5 2026; reference call with a logistics customer.

## How Hindsight Retain and Recall Are Used

1. **Retain** — `load_data.py` seeds the `meetings` bank with 9 synthetic meeting notes (3 each for Priya Sharma, Daniel Brooks, and Meera Iyer). Each note is a plain-English paragraph mentioning dates, promises, concerns, and open items; `client.retain(bank_id="meetings", content=note)` sends it to Hindsight Cloud (`https://api.hindsight.vectorize.io`), which extracts facts, entities, and dates automatically. New notes saved from the UI go through the same `retain` call via `agent.add_note(contact, note)`.

2. **Recall** — before writing a brief, `agent.recall(contact)` searches the bank with `client.recall(bank_id="meetings", query="Meetings with <contact>: ...")`. Hindsight runs four retrieval strategies in parallel (semantic, keyword, graph, temporal) and returns the relevant memories with dates and participants.

3. **Brief** — the recalled memories are injected into a prompt for Groq (`openai/gpt-oss-120b`), which writes the four-section brief. With **Memory OFF**, no recall happens and the model only gets a generic instruction — so the brief is generic and invents nothing.

Note: Hindsight extracts facts asynchronously after a `retain`, so freshly loaded notes can take a few seconds to show up in recall results.

## Tech Stack

- Python 3.11
- [Hindsight Cloud](https://hindsight.vectorize.io/) + `hindsight-client` (agent memory)
- Groq API, `openai/gpt-oss-120b` (LLM)
- Streamlit (UI)
- python-dotenv (config)

## Project Structure

```
meeting-prep-agent/
├── app.py            # Streamlit UI: contact picker, Memory toggle, Prep me, notes
├── agent.py          # recall(contact), brief(contact, use_memory), add_note(contact, note)
├── load_data.py      # Seeds 9 sample meeting notes into the "meetings" bank
├── requirements.txt
├── .env              # API keys (git-ignored, never committed)
└── README.md
```

## Setup

1. Create and activate a virtual environment (Python 3.11):
```bash
python -m venv venv
source venv/bin/activate          # Linux/macOS
venv/Scripts/activate             # Windows (Git Bash)
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the project root:
```
HINDSIGHT_API_KEY=your_hindsight_key
GROQ_API_KEY=your_groq_key
```
Get a Hindsight key at [hindsight.vectorize.io](https://hindsight.vectorize.io/) and a Groq key at [console.groq.com](https://console.groq.com/). `.env` is listed in `.gitignore`, so it stays local.

4. Load the sample data into memory:
```bash
python load_data.py
```

5. Run the app:
```bash
streamlit run app.py
```

## Usage

1. Pick a contact from the dropdown in the sidebar.
2. Leave **Memory ON** and click **Prep me** — you get a brief grounded in your saved meeting notes.
3. Flip **Memory OFF** and click **Prep me** again — same contact, generic brief. That contrast is the whole point.
4. After a real (or fake) meeting, type notes into the sidebar box and click **Save notes**. They are retained to Hindsight and improve the next brief.

API errors are caught and shown as friendly messages in the UI instead of tracebacks.

## Sample Data

The 9 meetings in `load_data.py` are synthetic, written to look like real business meetings — each one has dates, promises, concerns, and open items so the briefs have substance to work with.
