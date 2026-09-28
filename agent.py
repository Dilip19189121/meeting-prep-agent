"""Meeting Prep Agent core logic.

- recall(contact): pull the contact's meeting memories out of Hindsight.
- brief(contact, use_memory): ask Groq for a prep brief with the sections
  "What we discussed", "What I promised", "Still open", "Talking points".
- add_note(contact, note): retain a new note into memory.
"""

from __future__ import annotations

import os
from datetime import datetime

from dotenv import load_dotenv
from hindsight_client import Hindsight
from groq import Groq

load_dotenv()

BASE_URL = "https://api.hindsight.vectorize.io"
BANK_ID = "meetings"
GROQ_MODEL = "openai/gpt-oss-120b"

CONTACTS = ["Priya Sharma", "Daniel Brooks", "Meera Iyer"]

_hindsight: Hindsight | None = None
_groq: Groq | None = None


def _hindsight_client() -> Hindsight:
    global _hindsight
    if _hindsight is None:
        api_key = os.environ.get("HINDSIGHT_API_KEY")
        if not api_key:
            raise RuntimeError("HINDSIGHT_API_KEY is not set (add it to .env).")
        _hindsight = Hindsight(base_url=BASE_URL, api_key=api_key)
    return _hindsight


def _groq_client() -> Groq:
    global _groq
    if _groq is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY is not set (add it to .env).")
        _groq = Groq(api_key=api_key)
    return _groq


def recall(contact: str) -> str:
    """Fetch this contact's meeting memories from Hindsight.

    Raises RuntimeError on API failure so the caller can show a friendly error.
    """
    try:
        response = _hindsight_client().recall(
            bank_id=BANK_ID,
            query=(
                f"Meetings with {contact}: what we discussed, promises I made, "
                "their concerns, and open items"
            ),
            budget="high",
            max_tokens=4096,
        )
    except Exception as exc:  # noqa: BLE001 - converted to friendly error upstream
        raise RuntimeError(f"Hindsight recall failed: {exc}") from exc

    lines: list[str] = []
    for r in response.results or []:
        text = (r.text or "").strip()
        if text:
            lines.append(f"- {text}")
    return "\n".join(lines) if lines else ""


def add_note(contact: str, note: str) -> None:
    """Retain a new note for the contact into the memory bank."""
    if not note or not note.strip():
        raise ValueError("Note text is empty.")
    try:
        _hindsight_client().retain(
            bank_id=BANK_ID,
            content=note.strip(),
            context=f"Meeting notes with {contact}",
            document_id=f"meeting-{contact.split()[0].lower()}-{datetime.now():%Y%m%d-%H%M%S}",
            metadata={"contact": contact, "source": "streamlit-app"},
            retain_async=False,
        )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Hindsight retain failed: {exc}") from exc


BRIEF_PROMPT = """You are a sales/relationship prep assistant. Write a concise meeting-prep brief \
about {contact}. Today's date is {today}.

Use ONLY the notes below for factual claims. Do not invent meetings, promises, dates, or names.

Notes:
{notes}

Respond in exactly these four sections, each starting with a heading line and \
followed by 2-4 bullet points. If a section has no supporting notes, write a single \
bullet saying so.

## What we discussed
## What I promised
## Still open
## Talking points
"""


def brief(contact: str, use_memory: bool) -> str:
    """Generate a prep brief. With memory ON, recall injects Hindsight notes;
    with memory OFF, the model only gets a generic instruction (no notes)."""
    if use_memory:
        try:
            notes = recall(contact)
        except RuntimeError as exc:
            raise RuntimeError(str(exc)) from exc
        if not notes:
            notes = "(no memories found for this contact yet — try saving notes first)"
    else:
        notes = "(memory is OFF — no stored notes were consulted; write a generic brief)"

    prompt = BRIEF_PROMPT.format(contact=contact, today=datetime.now().strftime("%B %d, %Y"), notes=notes)

    try:
        completion = _groq_client().chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a crisp, businesslike meeting-prep assistant. "
                        "Never invent facts that are not in the notes."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_completion_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Groq request failed: {exc}") from exc

    return completion.choices[0].message.content or ""
