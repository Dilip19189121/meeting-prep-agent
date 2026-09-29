"""Meeting Prep Agent core logic.

- recall(contact): pull the contact's meeting memories out of Hindsight.
- brief(contact, use_memory): ask Groq for a prep brief with the sections
  "What we discussed", "What I promised", "Still open", "Talking points".
- add_note(contact, note): retain a new note into memory.
- risks(contact): detect at-risk items for a contact as structured JSON.
- simulate(contact, user_answer, history): roleplay a practice meeting with a contact.
- extract(contact, raw_notes): pull commitments out of post-meeting notes as JSON.
- save_commitments(contact, commitments): write each commitment into memory.
- add_contact(name): add a new contact and persist the list to contacts.json.

The async cores (arecall_core / aretain_core / abrief) use Hindsight's async
client methods (arecall / aretain) and AsyncGroq, so FastAPI endpoints can
await them directly on the server's event loop. The sync functions
(recall / brief / add_note) wrap the async cores with asyncio.run() for the
Streamlit app and CLI use.

If you see "Timeout context manager should be used inside a task", an async
client was bound to a dead event loop; the retry logic below rebuilds the
clients and retries, and close_async_clients() cleanly shuts them down on
server exit.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime

from dotenv import load_dotenv
from hindsight_client import Hindsight
from groq import AsyncGroq, Groq

load_dotenv()

BASE_URL = "https://api.hindsight.vectorize.io"
BANK_ID = "meetings"
GROQ_MODEL = "openai/gpt-oss-120b"

DEFAULT_CONTACTS = ["Priya Sharma", "Daniel Brooks", "Meera Iyer"]
CONTACTS: list[str] = list(DEFAULT_CONTACTS)

# Contacts persist to this file (next to agent.py) so they survive restarts.
CONTACTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "contacts.json")


def _load_contacts() -> None:
    """Merge saved contacts from contacts.json into CONTACTS (no duplicates)."""
    try:
        with open(CONTACTS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
    except FileNotFoundError:
        return
    except (OSError, ValueError) as exc:  # json.JSONDecodeError subclasses ValueError
        print(f"Warning: ignoring unreadable {CONTACTS_FILE}: {exc}")
        return
    if not isinstance(saved, list):
        return
    known = {c.casefold() for c in CONTACTS}
    for name in saved:
        if isinstance(name, str) and name.strip():
            clean = name.strip()
            if clean.casefold() not in known:
                CONTACTS.append(clean)
                known.add(clean.casefold())


def _save_contacts() -> None:
    """Persist the full CONTACTS list to contacts.json."""
    with open(CONTACTS_FILE, "w", encoding="utf-8") as f:
        json.dump(CONTACTS, f, indent=2)


def add_contact(name: str) -> None:
    """Add a new contact (case-insensitive dupe check) and persist the list.

    Raises ValueError if the name is empty or already in CONTACTS.
    """
    if not name or not name.strip():
        raise ValueError("Contact name is empty.")
    clean = name.strip()
    if any(c.casefold() == clean.casefold() for c in CONTACTS):
        raise ValueError(f"Contact {clean!r} already exists.")
    CONTACTS.append(clean)
    _save_contacts()


_load_contacts()

# How many times to retry transient Hindsight errors (dead event loop /
# timeout context manager / connection resets) before giving up.
ARECALL_MAX_ATTEMPTS = 3

_hindsight: Hindsight | None = None
_groq: Groq | None = None          # sync client, used by the Streamlit app
_groq_async: AsyncGroq | None = None


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


def _groq_async_client() -> AsyncGroq:
    global _groq_async
    if _groq_async is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY is not set (add it to .env).")
        _groq_async = AsyncGroq(api_key=api_key)
    return _groq_async


def _reset_clients() -> None:
    """Drop cached clients so the next call rebuilds them on the current loop."""
    global _hindsight, _groq_async
    _hindsight = None
    _groq_async = None


def _is_transient(exc: Exception) -> bool:
    msg = str(exc)
    markers = (
        "Timeout context manager",
        "Event loop is closed",
        "attached to a different loop",
        "event loop",
        "ClientOSError",
        "ServerDisconnectedError",
        "TimeoutError",
    )
    return any(m in msg for m in markers)


def _strip_json_fences(text: str) -> str:
    """Strip markdown ``` fences (with optional language tag) from LLM output."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Drop the opening fence line (```json / ```) and the trailing fence.
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else ""
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3]
    return cleaned.strip()


async def arecall_core(contact: str) -> str:
    """Async core: fetch this contact's meeting memories from Hindsight."""
    last_exc: Exception | None = None
    for attempt in range(1, ARECALL_MAX_ATTEMPTS + 1):
        try:
            response = await _hindsight_client().arecall(
                bank_id=BANK_ID,
                query=(
                    f"Meetings with {contact}: what we discussed, promises I made, "
                    "their concerns, and open items"
                ),
                budget="high",
                max_tokens=4096,
            )
            lines: list[str] = []
            for r in response.results or []:
                text = (r.text or "").strip()
                if text:
                    lines.append(f"- {text}")
            return "\n".join(lines) if lines else ""
        except Exception as exc:  # noqa: BLE001 - retried, then surfaced friendly
            last_exc = exc
            if attempt < ARECALL_MAX_ATTEMPTS and _is_transient(exc):
                _reset_clients()  # rebuild aiohttp session on the current loop
                await asyncio.sleep(1.5)
                continue
            break
    raise RuntimeError(f"Hindsight recall failed: {last_exc}") from last_exc


async def aretain_core(contact: str, note: str) -> None:
    """Async core: retain a new note for the contact into the memory bank."""
    if not note or not note.strip():
        raise ValueError("Note text is empty.")
    last_exc: Exception | None = None
    for attempt in range(1, ARECALL_MAX_ATTEMPTS + 1):
        try:
            await _hindsight_client().aretain(
                bank_id=BANK_ID,
                content=note.strip(),
                context=f"Meeting notes with {contact}",
                document_id=f"meeting-{contact.split()[0].lower()}-{datetime.now():%Y%m%d-%H%M%S}",
                metadata={"contact": contact, "source": "api"},
                retain_async=False,
            )
            return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < ARECALL_MAX_ATTEMPTS and _is_transient(exc):
                _reset_clients()
                await asyncio.sleep(1.5)
                continue
            break
    raise RuntimeError(f"Hindsight retain failed: {last_exc}") from last_exc


async def abrief(contact: str, use_memory: bool) -> str:
    """Async core: generate a prep brief with memory ON or OFF."""
    if use_memory:
        notes = await arecall_core(contact)
        if not notes:
            notes = "(no memories found for this contact yet — try saving notes first)"
    else:
        notes = "(memory is OFF — no stored notes were consulted; write a generic brief)"

    prompt = BRIEF_PROMPT.format(
        contact=contact, today=datetime.now().strftime("%B %d, %Y"), notes=notes
    )

    try:
        completion = await _groq_async_client().chat.completions.create(
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


async def arisks(contact: str) -> dict:
    """Async core: return {"risks": [...]} of at-risk items for this contact.

    Raises RuntimeError if memory is empty, the Groq request fails, or the
    model output is not valid JSON.
    """
    notes = await arecall_core(contact)
    if not notes:
        raise RuntimeError(
            f"No memories found for {contact!r}; save notes first."
        )

    prompt = RISKS_PROMPT.format(
        contact=contact, today=datetime.now().strftime("%B %d, %Y"), notes=notes
    )

    try:
        completion = await _groq_async_client().chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a risk-analysis assistant. Ground every claim in "
                        "the notes provided; never invent facts. Respond with ONLY "
                        "valid JSON and nothing else."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_completion_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Groq request failed: {exc}") from exc

    raw = completion.choices[0].message.content or ""
    try:
        data = json.loads(_strip_json_fences(raw))
        risks_list = data["risks"]
        if not isinstance(risks_list, list):
            raise ValueError("'risks' is not a list")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Risk detector returned invalid JSON: {raw!r}") from exc
    return {"risks": risks_list}


async def asimulate(
    contact: str, user_answer: str | None, history: list[dict] | None
) -> dict:
    """Async core: roleplay a practice meeting with this contact.

    history is a list of {"role": "contact" | "user", "content": "..."} turns.
    If user_answer is empty/None, returns the opening question with no feedback;
    otherwise returns one line of coaching feedback plus the next question.
    Returns {"contact_message": "...", "feedback": "..." | None}.
    """
    notes = await arecall_core(contact)
    if not notes:
        raise RuntimeError(
            f"No memories found for {contact!r}; save notes first."
        )

    turns = history or []
    if not user_answer or not user_answer.strip():
        prompt = SIMULATE_OPENING_PROMPT.format(contact=contact, notes=notes)
    else:
        transcript = "\n".join(
            f"{t.get('role', 'user')}: {t.get('content', '')}".strip()
            for t in turns
        ) or "(no prior turns)"
        prompt = SIMULATE_FOLLOWUP_PROMPT.format(
            contact=contact, notes=notes, transcript=transcript,
            answer=user_answer.strip(),
        )

    try:
        completion = await _groq_async_client().chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a meeting simulator and sales coach. Ground every "
                        "claim in the notes provided; never invent facts. Respond "
                        "with ONLY valid JSON and nothing else."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.6,
            max_completion_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Groq request failed: {exc}") from exc

    raw = completion.choices[0].message.content or ""
    try:
        data = json.loads(_strip_json_fences(raw))
        message = data["contact_message"]
        if not isinstance(message, str) or not message.strip():
            raise ValueError("'contact_message' is missing or empty")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Simulator returned invalid JSON: {raw!r}") from exc
    feedback = data.get("feedback")
    if feedback is not None and not isinstance(feedback, str):
        feedback = str(feedback)
    return {"contact_message": message, "feedback": feedback}
async def aextract(contact: str, raw_notes: str) -> dict:
    """Async core: extract commitments from raw post-meeting notes.

    Returns {"commitments": [{"owner", "action", "deadline"}]} grounded only
    in raw_notes. Raises RuntimeError on Groq failure or invalid JSON.
    """
    if not raw_notes or not raw_notes.strip():
        raise ValueError("Raw notes are empty.")

    prompt = EXTRACT_PROMPT.format(contact=contact, raw_notes=raw_notes)
    try:
        completion = await _groq_async_client().chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a precise meeting-notes analyst. Ground every "
                        "claim in the raw notes provided; never invent facts. "
                        "Respond with ONLY valid JSON and nothing else."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_completion_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Groq request failed: {exc}") from exc

    raw = completion.choices[0].message.content or ""
    try:
        data = json.loads(_strip_json_fences(raw))
        commitments = data["commitments"]
        if not isinstance(commitments, list):
            raise ValueError("'commitments' is not a list")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Extractor returned invalid JSON: {raw!r}") from exc
    return {"commitments": commitments}


async def asave_commitments(contact: str, commitments: list[dict]) -> None:
    """Async core: retain each commitment as one plain sentence into memory.

    Raises ValueError on empty commitments or a malformed entry; RuntimeError
    if any Hindsight retain fails.
    """
    if not commitments:
        raise ValueError("Commitments list is empty.")
    for c in commitments:
        owner = str(c.get("owner", "")).strip()
        action = str(c.get("action", "")).strip()
        deadline = c.get("deadline")
        if not action:
            raise ValueError(f"Commitment is missing an action: {c!r}")
        sentence = f"{owner} committed to {action}" if owner else f"Committed: {action}"
        if deadline:
            sentence = f"{sentence} (deadline: {deadline})"
        sentence = sentence.rstrip(".") + "."
        await aretain_core(contact, sentence)


# ------------------------- sync wrappers (Streamlit) ------------------------

def recall(contact: str) -> str:
    """Sync wrapper around arecall_core for the Streamlit app / CLI."""
    return asyncio.run(arecall_core(contact))


def add_note(contact: str, note: str) -> None:
    """Sync wrapper around aretain_core for the Streamlit app / CLI."""
    if not note or not note.strip():
        raise ValueError("Note text is empty.")
    asyncio.run(aretain_core(contact, note.strip()))


def brief(contact: str, use_memory: bool) -> str:
    """Sync wrapper around abrief for the Streamlit app / CLI."""
    return asyncio.run(abrief(contact, use_memory))


def risks(contact: str) -> dict:
    """Sync wrapper around arisks for the Streamlit app / CLI."""
    return asyncio.run(arisks(contact))


def simulate(contact: str, user_answer: str | None, history: list[dict] | None) -> dict:
    """Sync wrapper around asimulate for the Streamlit app / CLI."""
    return asyncio.run(asimulate(contact, user_answer, history))


def extract(contact: str, raw_notes: str) -> dict:
    """Sync wrapper around aextract for the Streamlit app / CLI."""
    return asyncio.run(aextract(contact, raw_notes))


def save_commitments(contact: str, commitments: list[dict]) -> None:
    """Sync wrapper around asave_commitments for the Streamlit app / CLI."""
    asyncio.run(asave_commitments(contact, commitments))


async def aclose_clients() -> None:
    """Close async clients; call from FastAPI's shutdown event."""
    global _hindsight, _groq_async
    if _hindsight is not None:
        try:
            await _hindsight.aclose()
        except Exception:  # noqa: BLE001
            pass
        _hindsight = None
    if _groq_async is not None:
        try:
            await _groq_async.close()
        except Exception:  # noqa: BLE001
            pass
        _groq_async = None


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


RISKS_PROMPT = """You are a sales/relationship risk analyst. Review the notes about \
{contact} and flag anything that puts the relationship or open work at risk. \
Today's date is {today}. Use relative timing against today's date: an item with a \
promise or review date in the past, or a commitment with no follow-up, is at risk.

Use ONLY the notes below for factual claims. Do not invent items, dates, or names.

Notes:
{notes}

Return ONLY a JSON object (no markdown, no commentary) shaped exactly like this:
{{"risks": [{{"item": "...", "level": "critical | attention | normal", "reason": "one sentence, grounded in the notes"}}]}}

- "item": short name of the risk (e.g. "SOC 2 report overdue").
- "level": exactly one of "critical", "attention", or "normal".
- "reason": one sentence grounded in the notes; mention dates when the notes have them.
List only real items from the notes. If nothing is at risk, return an empty list.
"""


SIMULATE_OPENING_PROMPT = """You are roleplaying AS {contact} in a practice meeting \
with their account manager (the user). Stay fully in character as {contact}, using \
the personality, priorities, and history from the notes below.

Use ONLY the notes below for factual claims. Do not invent meetings, promises, dates, or names.

Notes:
{notes}

Open the meeting as {contact} would: greet the user briefly, then ask ONE opening \
question about something real from the notes (an open item, a concern, or an upcoming \
decision). Keep it to 1-3 sentences.

Return ONLY a JSON object (no markdown, no commentary) shaped exactly like this:
{{"contact_message": "...", "feedback": null}}
"""


SIMULATE_FOLLOWUP_PROMPT = """You are roleplaying AS {contact} in a practice meeting \
with their account manager (the user). Stay fully in character as {contact}, using \
the personality, priorities, and history from the notes below.

Use ONLY the notes below for factual claims. Do not invent meetings, promises, dates, or names.

Notes:
{notes}

Conversation so far:
{transcript}

The user just answered: "{answer}"

First, give ONE line of coaching feedback on that answer from the perspective of a \
sales coach (was it specific, did it address the concern, did it use real facts?). \
Then, still in character as {contact}, respond to the answer and ask the NEXT question \
about another real item from the notes. Put the coach feedback in "feedback" and \
{contact}'s in-character reply (response + next question) in "contact_message".

Return ONLY a JSON object (no markdown, no commentary) shaped exactly like this:
{{"contact_message": "...", "feedback": "... or null"}}
"""


EXTRACT_PROMPT = """You are a meeting-notes analyst. Read the raw post-meeting notes \
about {contact} below and extract every commitment made by either side (the user \
/the account manager, or {contact} / their team).

Ground every commitment ONLY in the raw notes below. Do not invent actions, owners, \
or dates. If a deadline is stated, copy it exactly as written (e.g. "Oct 5", \
"2026-10-05"); if no deadline is stated, use null.

Raw notes:
{raw_notes}

Return ONLY a JSON object (no markdown, no commentary) shaped exactly like this:
{{"commitments": [{{"owner": "you | contact name", "action": "...", "deadline": "date or null"}}]}}

- "owner": exactly "you" when the user/account manager made the commitment; otherwise \
the person's name as written in the notes (e.g. "{contact}").
- "action": one short plain sentence describing the commitment.
- "deadline": the stated deadline, or null.
If there are no commitments, return an empty list.
"""
