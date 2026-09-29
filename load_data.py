"""Seed the 'meetings' memory bank with fake meeting notes.

Run directly:
    python load_data.py

Requires HINDSIGHT_API_KEY in .env. Retains 9 notes total: 3 meetings each
for Priya Sharma, Daniel Brooks and Meera Iyer.
"""

from __future__ import annotations

import os
import sys
import time

from dotenv import load_dotenv
from hindsight_client import Hindsight

BANK_ID = "meetings"
BASE_URL = "https://api.hindsight.vectorize.io"

CONTACTS = ["Priya Sharma", "Daniel Brooks", "Meera Iyer"]

# 9 fake meeting notes: 3 per contact, each with dates, promises, concerns
# and open items.
MEETING_NOTES: dict[str, list[str]] = {
    "Priya Sharma": [
        (
            "Meeting with Priya Sharma (VP Engineering, Northwind Logistics) on March 4, 2026, "
            "in her office. Discussed their vendor consolidation project: she said the platform "
            "migrates off three legacy carriers by June 2026. I promised to send the security "
            "document — our SOC 2 report and encryption whitepaper — by March 18. Priya is "
            "concerned about downtime during cutover and asked twice about our 99.9% SLA. "
            "Open item: she wants a reference call with a logistics customer before signing."
        ),
        (
            "Meeting with Priya Sharma on April 9, 2026, over video call. Discussed the SLA "
            "audit results; the Q1 report showed two missed uptime targets in January. I promised "
            "a root-cause writeup and a service credit within two weeks. Priya raised a concern "
            "that her CFO is questioning total spend. She is presenting our platform at her "
            "company's board meeting on June 12, 2026, and wants her deck finalized by June 5. "
            "Open item: pricing review meeting with her finance team not yet scheduled."
        ),
        (
            "Meeting with Priya Sharma on May 21, 2026, at the Chicago logistics summit. She "
            "announced she was promoted to COO effective July 1, 2026, and her old VP role is "
            "being split between two directors. I promised to introduce her to our retail "
            "success lead. She is concerned about inheriting an understaffed ops team. Open "
            "item: renewal talks for the enterprise contract start in August 2026."
        ),
    ],
    "Daniel Brooks": [
        (
            "Meeting with Daniel Brooks (Head of Data, Fernwell Health) on February 12, 2026, "
            "at his lab. Discussed the patient-analytics pilot: ingestion pipeline processed "
            "12M records with zero errors in the January trial. I promised a security review "
            "packet by February 26. Daniel is concerned about HIPAA compliance sign-off from "
            "his legal team. Open item: pilot success criteria still not written down."
        ),
        (
            "Meeting with Daniel Brooks on March 27, 2026, phone call. He said legal returned "
            "the security packet with questions about data residency; answers are due back "
            "April 10. I promised to loop in our compliance officer for a joint call. Daniel "
            "expressed concern that the pilot timeline slips if approval drags past April. "
            "Open item: he asked for a HIPAA business associate agreement draft."
        ),
        (
            "Meeting with Daniel Brooks on May 5, 2026, at his office. Pilot phase 2 kicked "
            "off with three clinics onboarded. I promised monthly usage reports starting June 1. "
            "Daniel is concerned about staff training time at the clinics; nurses can spare "
            "only two hours per week. Open item: decision on expanding to all 11 clinics "
            "expected end of June 2026."
        ),
    ],
    "Meera Iyer": [
        (
            "Meeting with Meera Iyer (CFO, Brightpath Retail) on January 20, 2026, at HQ. "
            "Discussed the budget freeze ending in Q2. I promised a cost-savings analysis of "
            "consolidating their analytics tools by February 3. Meera is concerned about vendor "
            "sprawl — they pay for 7 overlapping tools. Open item: she owes me an intro to her "
            "procurement lead."
        ),
        (
            "Meeting with Meera Iyer on March 14, 2026, video call. Discussed the savings "
            "analysis; model shows 28% reduction if they consolidate by September 2026. I "
            "promised to prepare board-deck slides for her June board meeting. Meera is "
            "concerned the CTO will resist losing his favorite tool. Open item: need final "
            "sign-off from the CTO before the board sees anything."
        ),
        (
            "Meeting with Meera Iyer on April 29, 2026, at the quarterly review. She confirmed "
            "the CTO signed off after we agreed to keep the forecasting module. I promised to "
            "hold discount pricing until July 31, 2026. Meera is concerned about their renewal "
            "with the incumbent landing in the same month. Open item: joint session with her "
            "procurement lead to be scheduled for early June."
        ),
    ],
}


def get_client() -> Hindsight:
    api_key = os.environ.get("HINDSIGHT_API_KEY")
    if not api_key:
        raise SystemExit("HINDSIGHT_API_KEY is not set (check your .env).")
    return Hindsight(base_url=BASE_URL, api_key=api_key)


def load_data(async_retain: bool = False) -> None:
    """Retain all 9 meeting notes into the 'meetings' bank."""
    client = get_client()

    for contact, notes in MEETING_NOTES.items():
        for i, note in enumerate(notes, start=1):
            try:
                client.retain(
                    bank_id=BANK_ID,
                    content=note,
                    context=f"Meeting notes with {contact} (note {i} of 3)",
                    document_id=f"meeting-{contact.split()[0].lower()}-{i:02d}",
                    metadata={"contact": contact, "note_index": str(i)},
                    retain_async=async_retain,
                )
                print(f"[OK] Retained note {i}/3 for {contact}")
            except Exception as exc:  # noqa: BLE001 - surface any API failure
                print(f"[FAIL] {contact} note {i}: {exc}", file=sys.stderr)
                raise

    print(f"\nDone. {sum(len(v) for v in MEETING_NOTES.values())} notes retained to bank '{BANK_ID}'.")
    if not async_retain:
        print("Note: Hindsight extraction runs async server-side; recall may take a few seconds to reflect new notes.")


if __name__ == "__main__":
    load_dotenv()
    load_data()
    time.sleep(1)
