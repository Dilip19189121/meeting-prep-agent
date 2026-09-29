"""FastAPI wrapper around the Meeting Prep Agent.

Run:
    uvicorn api:app --reload --port 8000

Endpoints:
    GET  /contacts  -> list of contacts
    POST /contacts  -> {name} -> add a contact, returns the updated list
    POST /brief     -> {contact, use_memory} -> markdown prep brief
    POST /note      -> {contact, note} -> retain a note to memory
    POST /risks     -> {contact} -> at-risk items as JSON
    POST /simulate  -> {contact, user_answer, history} -> roleplayed meeting turn
    POST /extract      -> {contact, raw_notes} -> extracted commitments
    POST /extract/save -> {contact, commitments} -> save commitments to memory
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import agent
from agent import (
    abrief,
    add_contact,
    aretain_core,
    aclose_clients,
    arisks,
    asimulate,
    aextract,
    asave_commitments,
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await aclose_clients()


app = FastAPI(title="Meeting Prep Agent API", lifespan=lifespan)

# Allow the Vite dev servers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AddContactRequest(BaseModel):
    # No min_length: let add_contact raise ValueError -> 400 for empty names.
    name: str = Field(..., examples=["Test Person"])


class BriefRequest(BaseModel):
    contact: str = Field(..., examples=["Priya Sharma"])
    use_memory: bool = True


class NoteRequest(BaseModel):
    contact: str = Field(..., examples=["Priya Sharma"])
    note: str = Field(..., min_length=1)


class RiskRequest(BaseModel):
    contact: str = Field(..., examples=["Priya Sharma"])


class SimulateRequest(BaseModel):
    contact: str = Field(..., examples=["Priya Sharma"])
    user_answer: str | None = None
    history: list[dict[str, str]] = Field(default_factory=list)


class ExtractRequest(BaseModel):
    contact: str = Field(..., examples=["Priya Sharma"])
    raw_notes: str = Field(..., min_length=1)


class SaveCommitmentsRequest(BaseModel):
    contact: str = Field(..., examples=["Priya Sharma"])
    commitments: list[dict] = Field(..., min_length=1)


@app.get("/contacts")
def get_contacts() -> dict[str, list[str]]:
    return {"contacts": list(agent.CONTACTS)}


@app.post("/contacts")
def post_contacts(req: AddContactRequest) -> dict[str, list[str]]:
    try:
        add_contact(req.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"contacts": list(agent.CONTACTS)}


@app.post("/brief")
async def post_brief(req: BriefRequest) -> dict[str, str]:
    try:
        text = await abrief(req.contact, req.use_memory)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"brief": text}


@app.post("/note")
async def post_note(req: NoteRequest) -> dict[str, str]:
    try:
        await aretain_core(req.contact, req.note)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "message": f"Note saved to memory for {req.contact}."}


@app.post("/risks")
async def post_risks(req: RiskRequest) -> dict:
    try:
        return await arisks(req.contact)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/simulate")
async def post_simulate(req: SimulateRequest) -> dict:
    try:
        return await asimulate(req.contact, req.user_answer, req.history)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/extract")
async def post_extract(req: ExtractRequest) -> dict:
    try:
        return await aextract(req.contact, req.raw_notes)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/extract/save")
async def post_extract_save(req: SaveCommitmentsRequest) -> dict:
    try:
        await asave_commitments(req.contact, req.commitments)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}
