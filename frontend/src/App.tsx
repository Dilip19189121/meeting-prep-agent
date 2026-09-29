/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {useCallback, useEffect, useState} from 'react';

const API_BASE = 'http://localhost:8000';

type RiskLevel = 'critical' | 'attention' | 'normal' | string;
type Risk = {item: string; level: RiskLevel; reason: string};
type Commitment = {owner: string; action: string; deadline: string | null};
type SimTurn = {role: 'contact' | 'user'; content: string; feedback?: string | null};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: {'Content-Type': 'application/json'},
      ...init,
    });
  } catch {
    throw new Error('Cannot reach the backend at http://localhost:8000 — is the API server running?');
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && typeof (body as {detail?: unknown}).detail === 'string'
        ? (body as {detail: string}).detail
        : body
        ? JSON.stringify((body as {detail?: unknown}).detail ?? body)
        : '';
    throw new Error(detail || `Request failed (HTTP ${res.status})`);
  }
  return body as T;
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 text-white"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        fill="currentColor"
      ></path>
    </svg>
  );
}

export default function App() {
  const [contacts, setContacts] = useState<string[]>([
    'Priya Sharma (VP Engineering, FinCloud)',
    'Daniel Brooks (Head of Product, Lattice)',
    'Meera Iyer (Principal Architect, Sora Infra)',
  ]);
  const [activeContact, setActiveContact] = useState<string>(
    'Priya Sharma (VP Engineering, FinCloud)'
  );
  const [newContactName, setNewContactName] = useState<string>('');
  const [memoryActive, setMemoryActive] = useState<boolean>(true);
  const [simulationReply, setSimulationReply] = useState<string>('');
  const [meetingNotes, setMeetingNotes] = useState<string>(
    'Meeting with Priya Sharma (Oct 21). We agreed that Alex will send the updated SLA documentation by Oct 24, 2025. Priya committed to reviewing the auth migration milestones by Oct 28. Next sync scheduled for next Thursday.'
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // --- Backend state ---
  const [addingContact, setAddingContact] = useState<boolean>(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [briefText, setBriefText] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState<boolean>(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [risks, setRisks] = useState<Risk[] | null>(null);
  const [risksLoading, setRisksLoading] = useState<boolean>(false);
  const [risksError, setRisksError] = useState<string | null>(null);
  const [simChat, setSimChat] = useState<SimTurn[]>([]);
  const [simLoading, setSimLoading] = useState<boolean>(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [commitments, setCommitments] = useState<Commitment[] | null>(null);
  const [extractLoading, setExtractLoading] = useState<boolean>(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [savedToMemory, setSavedToMemory] = useState<boolean>(false);
  const [saveLoading, setSaveLoading] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // On load, replace the hardcoded contacts with the real backend list.
  useEffect(() => {
    api<{contacts: string[]}>('/contacts')
      .then((data) => {
        if (data.contacts.length > 0) {
          setContacts(data.contacts);
          setActiveContact(data.contacts[0]);
        }
      })
      .catch(() => {
        /* backend not running yet; keep the static demo list */
      });
  }, []);

  const handleAddContact = useCallback(async () => {
    if (!newContactName.trim()) return;
    setAddingContact(true);
    setContactError(null);
    try {
      const data = await api<{contacts: string[]}>('/contacts', {
        method: 'POST',
        body: JSON.stringify({name: newContactName.trim()}),
      });
      setContacts(data.contacts);
      setActiveContact(newContactName.trim());
      setNewContactName('');
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Failed to add contact.');
    } finally {
      setAddingContact(false);
    }
  }, [newContactName]);

  const handlePrepMe = useCallback(async () => {
    setBriefLoading(true);
    setBriefError(null);
    try {
      const data = await api<{brief: string}>('/brief', {
        method: 'POST',
        body: JSON.stringify({contact: activeContact, use_memory: memoryActive}),
      });
      setBriefText(data.brief);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : 'Failed to generate brief.');
    } finally {
      setBriefLoading(false);
    }
  }, [activeContact, memoryActive]);

  const handleRescanRisks = useCallback(async () => {
    setRisksLoading(true);
    setRisksError(null);
    try {
      const data = await api<{risks: Risk[]}>('/risks', {
        method: 'POST',
        body: JSON.stringify({contact: activeContact}),
      });
      setRisks(data.risks);
    } catch (err) {
      setRisksError(err instanceof Error ? err.message : 'Failed to scan risks.');
    } finally {
      setRisksLoading(false);
    }
  }, [activeContact]);

  const handleSendSimulation = useCallback(async () => {
    if (simLoading) return;
    const opening = !simulationReply.trim() && simChat.length === 0;
    setSimLoading(true);
    setSimError(null);
    try {
      const history: Array<{role: 'contact' | 'user'; content: string}> = simChat.map(
        ({role, content}) => ({role, content})
      );
      const data = await api<{contact_message: string; feedback: string | null}>('/simulate', {
        method: 'POST',
        body: JSON.stringify({
          contact: activeContact,
          user_answer: opening ? null : simulationReply,
          history,
        }),
      });
      setSimChat((prev) => {
        const next = [...prev];
        if (!opening) next.push({role: 'user', content: simulationReply, feedback: data.feedback});
        next.push({role: 'contact', content: data.contact_message});
        return next;
      });
      setSimulationReply('');
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Failed to simulate.');
    } finally {
      setSimLoading(false);
    }
  }, [activeContact, simChat, simLoading, simulationReply]);

  const handleExtractCommitments = useCallback(async () => {
    setExtractLoading(true);
    setExtractError(null);
    setSavedToMemory(false);
    try {
      const data = await api<{commitments: Commitment[]}>('/extract', {
        method: 'POST',
        body: JSON.stringify({contact: activeContact, raw_notes: meetingNotes}),
      });
      setCommitments(data.commitments);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract commitments.');
    } finally {
      setExtractLoading(false);
    }
  }, [activeContact, meetingNotes]);

  const handleSaveToMemory = useCallback(async () => {
    if (!commitments || commitments.length === 0) return;
    setSaveLoading(true);
    setSaveError(null);
    try {
      await api<{status: string}>('/extract/save', {
        method: 'POST',
        body: JSON.stringify({contact: activeContact, commitments}),
      });
      setSavedToMemory(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save commitments.');
    } finally {
      setSaveLoading(false);
    }
  }, [activeContact, commitments]);

  return (
    <div className="min-h-screen bg-brand-surface text-brand-charcoal font-sans antialiased selection:bg-brand-teal selection:text-white">
      {/* BEGIN: MainHeader */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-white/70 border-b border-brand-sand transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 h-20 flex items-center justify-between">
          {/* Brand Logo */}
          <a className="group flex items-center gap-3" href="#start">
            <span className="text-2xl font-light tracking-editorial text-brand-charcoal transition-colors group-hover:text-brand-teal">
              meet<span className="font-medium text-brand-woodDark">mind</span>
            </span>
          </a>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-10 text-xs tracking-architectural uppercase text-brand-slateText font-medium">
            <a className="hover:text-brand-teal transition-colors" href="#start">
              Start
            </a>
            <a className="hover:text-brand-teal transition-colors" href="#how">
              How it works
            </a>
            <a className="hover:text-brand-teal transition-colors" href="#app">
              Demo
            </a>
            <a className="hover:text-brand-teal transition-colors" href="#memory">
              Memory
            </a>
          </nav>

          {/* Action Button matching reference 'MENU' teal block button */}
          <div className="flex items-center gap-4">
            <a
              aria-label="Direct to interactive demo"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="inline-flex items-center justify-center px-6 py-2.5 bg-brand-teal hover:bg-brand-tealDark text-white text-xs font-semibold tracking-architectural uppercase rounded-sm shadow-sm transition-all duration-200"
              href="#app"
            >
              MENU
            </a>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <nav className="md:hidden bg-white/95 backdrop-blur-md border-b border-brand-sand px-6 py-4 flex flex-col space-y-3 text-xs tracking-architectural uppercase text-brand-slateText font-medium">
            <a
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-brand-teal transition-colors py-1"
              href="#start"
            >
              Start
            </a>
            <a
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-brand-teal transition-colors py-1"
              href="#how"
            >
              How it works
            </a>
            <a
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-brand-teal transition-colors py-1"
              href="#app"
            >
              Demo
            </a>
            <a
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-brand-teal transition-colors py-1"
              href="#memory"
            >
              Memory
            </a>
          </nav>
        )}
      </header>
      {/* END: MainHeader */}

      {/* BEGIN: HeroSection */}
      <section
        className="relative min-h-[92vh] pt-28 pb-20 flex items-center overflow-hidden bg-brand-surface"
        id="start"
      >
        {/* Background Image Layer matching reference layout atmosphere */}
        <div className="absolute inset-0 z-0 bg-stone-700">
          <img
            alt="Serene Japanese architectural interior with warm natural daylight, wood table, and plants"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center filter saturate-[0.85] contrast-[0.95]"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCaj5-f8l_6Bz1DMyvt74Zo1Ekgjrrri2mlg3vcHMi5ttBwxJwB6yJZ3vxzMhk8TcASvEr9pmNZOw_d69rYDhY3-bQLePa4Ss3iC-RRGk7bLEUps2FZmffGXqXxxoEYr0PQt_-Dm8l8V_ep3a4WC9IVNTjRf5C22RNJo-io7wVavHHWP9YvsLmyiXKjmDE4-Gh-pelueBhoaREX4mFTyCA72nO32EqEpTuSBwa_TYJ0L6yZP4dBOag"
          />
          {/* Soft ambient daylight lens and warm tone overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-brand-charcoal/40 via-brand-charcoal/20 to-transparent"></div>
          <div className="absolute inset-0 sunlight-glow"></div>
          <div className="absolute inset-0 bg-brand-surface/20 backdrop-blur-[1.5px]"></div>
        </div>

        {/* Massive Architectural Typography Watermark (like 'BRIGHT AVENUE') */}
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none select-none overflow-hidden">
          <h2 className="architectural-watermark tracking-tight w-full text-center">
            MEETMIND
          </h2>
        </div>

        {/* Hero Content Container */}
        <div className="relative z-20 max-w-7xl mx-auto px-6 lg:px-12 w-full pt-12 pb-4">
          {/* Single flex-col stack: label, headline, tagline, sub-copy, CTAs, metadata */}
          <div className="max-w-2xl text-left flex flex-col items-start gap-4">
            {/* English Eyebrow */}
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/70 backdrop-blur-md rounded-sm border border-white/50 text-xs font-medium tracking-editorial text-brand-charcoal">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-teal"></span>
              <span>RELIABILITY ARCHITECTURE</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl sm:text-6xl font-light tracking-tight text-white drop-shadow-md leading-tight">
              Meet<span className="font-normal text-white">Mind</span>
            </h1>

            {/* English Value Proposition Subtitle */}
            <p className="text-xl sm:text-2xl text-white/95 font-light tracking-wide drop-shadow">
              It never forgets a promise you made.
            </p>

            {/* English Sub-copy */}
            <p className="text-sm sm:text-base text-white/85 font-light leading-relaxed max-w-xl drop-shadow-sm">
              Never miss a client commitment or drop the ball again.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-4">
              <a
                className="px-8 py-3.5 bg-brand-teal hover:bg-brand-tealDark text-white text-xs font-semibold tracking-architectural uppercase rounded-sm shadow-md transition-all duration-200 hover:translate-y-[-1px]"
                href="#app"
              >
                Try the demo
              </a>
              <a
                className="px-8 py-3.5 bg-white/80 hover:bg-white text-brand-charcoal text-xs font-semibold tracking-architectural uppercase rounded-sm backdrop-blur-sm border border-white/80 shadow-sm transition-all duration-200"
                href="#how"
              >
                How it works
              </a>
            </div>

            {/* Lower Architectural Metadata Specification in Micro-typography
                (normal document flow below the CTAs -- never overlaps them) */}
            <div className="mt-6 text-[11px] tracking-widest text-white/75 font-mono">
              Hindsight Core Engine · Vectorize Architecture
            </div>
          </div>
        </div>
      </section>
      {/* END: HeroSection */}

      {/* BEGIN: HowItWorks */}
      <section
        className="py-28 bg-brand-surface relative border-b border-brand-sand"
        id="how"
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-12">
          {/* Section Header */}
          <div className="max-w-2xl mb-16">
            <span className="text-xs font-semibold uppercase tracking-architectural text-brand-teal block mb-3">
              Architecture &amp; Principles
            </span>
            <h2 className="text-3xl sm:text-4xl font-light text-brand-charcoal tracking-tight">
              Designed with the permanence of stone, the agility of thought.
            </h2>
            <p className="mt-4 text-sm sm:text-base text-brand-slateText leading-relaxed">
              Four continuous phases ensure conversations become lasting assets, not forgotten moments.
            </p>
          </div>

          {/* 4-Column Modular Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Card 1: Retain */}
            <div className="bg-white p-8 rounded-sm border border-stone-200 shadow-sm hover:shadow-md transition-shadow relative">
              <div className="text-xs font-mono text-brand-teal font-semibold mb-6">
                01 / CAPTURE
              </div>
              <h3 className="text-xl font-normal text-brand-charcoal mb-3">Retain</h3>
              <p className="text-sm text-brand-slateText leading-relaxed">
                Every meeting note, casual mention, or transcript is saved to high-dimensional cognitive memory.
              </p>
            </div>

            {/* Card 2: Recall */}
            <div className="bg-white p-8 rounded-sm border border-stone-200 shadow-sm hover:shadow-md transition-shadow relative">
              <div className="text-xs font-mono text-brand-teal font-semibold mb-6">
                02 / RECALL
              </div>
              <h3 className="text-xl font-normal text-brand-charcoal mb-3">Recall</h3>
              <p className="text-sm text-brand-slateText leading-relaxed">
                Past promises, nuanced concerns, and open items are surfaced automatically before you even ask.
              </p>
            </div>

            {/* Card 3: Prepare */}
            <div className="bg-white p-8 rounded-sm border border-stone-200 shadow-sm hover:shadow-md transition-shadow relative">
              <div className="text-xs font-mono text-brand-teal font-semibold mb-6">
                03 / PREPARE
              </div>
              <h3 className="text-xl font-normal text-brand-charcoal mb-3">Prepare</h3>
              <p className="text-sm text-brand-slateText leading-relaxed">
                Get an instant executive briefing, an active risk check, or simulate the dialogue before joining the call.
              </p>
            </div>

            {/* Card 4: Act */}
            <div className="bg-white p-8 rounded-sm border border-stone-200 shadow-sm hover:shadow-md transition-shadow relative">
              <div className="text-xs font-mono text-brand-teal font-semibold mb-6">
                04 / EXECUTE
              </div>
              <h3 className="text-xl font-normal text-brand-charcoal mb-3">Act</h3>
              <p className="text-sm text-brand-slateText leading-relaxed">
                After the meeting, paste raw notes. Commitments and timelines are extracted and stored permanently.
              </p>
            </div>
          </div>
        </div>
      </section>
      {/* END: HowItWorks */}

      {/* BEGIN: InteractiveDemoSection */}
      <section className="py-24 bg-[#F5F4F0] relative" id="app">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          {/* Section Intro Header */}
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="text-xs font-semibold tracking-architectural uppercase text-brand-teal block mb-2">
              Live Demonstration
            </span>
            <h2 className="text-3xl font-light text-brand-charcoal tracking-tight">
              The MeetMind Operating Console
            </h2>
            <p className="mt-2 text-sm text-brand-slateText">
              Explore the five coordinated engines handling your professional recall.
            </p>
          </div>

          {/* MAIN CONTAINER: 5 Vertically Stacked Modules */}
          <div className="space-y-10">
            {/* MODULE A: Contact Bar */}
            <div
              className="bg-white p-6 rounded-sm border border-stone-200 shadow-sm"
              data-purpose="contact-bar-module"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                  <label
                    className="text-xs uppercase tracking-architectural font-medium text-brand-charcoal"
                    htmlFor="contact-selector"
                  >
                    Active Contact:
                  </label>
                  <div className="relative">
                    <select
                      id="contact-selector"
                      value={activeContact}
                      onChange={(e) => setActiveContact(e.target.value)}
                      className="w-full sm:w-80 appearance-none text-sm bg-stone-50 border border-stone-300 text-brand-charcoal rounded-sm py-2 px-3 pr-8 focus:outline-none focus:ring-1 focus:ring-brand-teal focus:border-brand-teal"
                    >
                      {contacts.map((contact) => (
                        <option key={contact} value={contact}>
                          {contact}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-stone-500">
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Inline Add Contact Group */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="Add contact name..."
                    className="w-full sm:w-auto text-xs bg-stone-50 border border-stone-300 rounded-sm py-2 px-3 focus:outline-none focus:ring-1 focus:ring-brand-teal focus:border-brand-teal"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      handleAddContact();
                    }}
                    className="px-4 py-2 bg-brand-teal hover:bg-brand-tealDark text-white text-xs font-medium tracking-editorial uppercase rounded-sm transition-colors whitespace-nowrap cursor-pointer inline-flex items-center gap-2"
                  >
                    {addingContact && <Spinner />}
                    + Add
                  </button>
                </div>
              </div>
              {contactError && (
                <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
                  {contactError}
                </p>
              )}
            </div>

            {/* MODULE B: Brief (Executive Briefing & Side-by-Side Comparison) */}
            <div
              className="bg-white p-6 sm:p-8 rounded-sm border border-stone-200 shadow-sm space-y-6"
              data-purpose="brief-module"
            >
              {/* Module Header & Memory Toggle */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-architectural text-brand-teal">
                    Phase 01
                  </span>
                  <h3 className="text-xl font-normal text-brand-charcoal">
                    Executive Pre-Call Briefing
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {/* Memory Toggle */}
                  <div className="flex items-center gap-3 bg-brand-surface px-4 py-2 rounded-sm border border-stone-200">
                    <span className="text-xs font-medium text-brand-charcoal">
                      Persistent Memory
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={memoryActive}
                      onClick={() => setMemoryActive((prev) => !prev)}
                      className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        memoryActive ? 'bg-brand-teal' : 'bg-stone-300'
                      }`}
                    >
                      <span
                        className={`${
                          memoryActive ? 'translate-x-5' : 'translate-x-0'
                        } inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 shadow-sm`}
                      ></span>
                    </button>
                    <span className="text-xs font-semibold text-brand-teal">
                      {memoryActive ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handlePrepMe();
                    }}
                    className="px-5 py-2 bg-stone-800 hover:bg-stone-900 text-white text-xs tracking-editorial uppercase font-medium rounded-sm cursor-pointer transition-colors inline-flex items-center gap-2"
                  >
                    {briefLoading && <Spinner />}
                    Prep Me
                  </button>
                </div>
              </div>

              {/* Comparison Side-by-Side Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                {/* Left: Memory OFF */}
                <div className="border border-stone-200 bg-stone-50/60 p-5 rounded-sm">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-stone-200">
                    <span className="text-xs uppercase tracking-wider text-stone-500 font-medium">
                      Memory OFF (Generic AI)
                    </span>
                    <span className="text-[10px] bg-stone-200 text-stone-600 px-2 py-0.5 rounded font-mono">
                      Standard LLM
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 mb-3 italic">
                    &ldquo;Prepare to discuss the ongoing platform stability and introduce our standard SLAs.&rdquo;
                  </p>
                  <ul className="text-xs text-stone-500 space-y-2 list-disc list-inside">
                    <li>Review typical enterprise contract terms</li>
                    <li>Ask general questions about team structure</li>
                    <li>Offer basic support escalation paths</li>
                  </ul>
                </div>

                {/* Right: Memory ON (Remembers) */}
                <div className="border-2 border-brand-teal bg-brand-tealLight/25 p-5 rounded-sm relative">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-brand-teal/20">
                    <span className="text-xs uppercase tracking-wider text-brand-teal font-semibold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-brand-teal animate-pulse"></span>
                      Memory ON (Remembers)
                    </span>
                    <span className="text-[10px] bg-brand-teal text-white px-2 py-0.5 rounded font-mono">
                      MeetMind Core
                    </span>
                  </div>
                  {briefText ? (
                    <pre className="text-xs text-brand-slateText whitespace-pre-wrap font-sans leading-relaxed max-h-72 overflow-y-auto">
                      {briefText}
                    </pre>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-brand-charcoal mb-3">
                        &ldquo;Priya asked for the{' '}
                        <span className="text-brand-teal font-semibold">
                          API security audit last Tuesday
                        </span>
                        . She has a board review next Monday and is concerned about 99.99% latency thresholds.&rdquo;
                      </p>
                      <ul className="text-xs text-brand-slateText space-y-2">
                        <li className="flex items-start gap-2">
                          <span className="text-brand-teal font-bold">✓</span>
                          <span>
                            <strong>Past Commitment:</strong> Alex promised the updated ISO-27001 token flow diagram.
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-brand-teal font-bold">✓</span>
                          <span>
                            <strong>Personal Rapport:</strong> Mentioned her son’s robotics competition in Kyoto this weekend.
                          </span>
                        </li>
                      </ul>
                    </>
                  )}
                </div>
              </div>
              {briefError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
                  {briefError}
                </p>
              )}
            </div>

            {/* MODULE C: Risk Check */}
            <div
              className="bg-white p-6 sm:p-8 rounded-sm border border-stone-200 shadow-sm space-y-6"
              data-purpose="risk-check-module"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-architectural text-brand-teal">
                    Phase 02
                  </span>
                  <h3 className="text-xl font-normal text-brand-charcoal">
                    Commitment &amp; Relational Risk Analysis
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleRescanRisks();
                  }}
                  className="px-5 py-2 bg-brand-teal hover:bg-brand-tealDark text-white text-xs tracking-editorial uppercase font-medium rounded-sm cursor-pointer transition-colors self-start sm:self-auto inline-flex items-center gap-2"
                >
                  {risksLoading && <Spinner />}
                  Re-Scan Risks
                </button>
              </div>

              {/* Risk Items with Specific Colored Left Borders (min 4px) */}
              <div className="space-y-3">
                {(risks
                  ? risks.map((risk) => {
                      const color =
                        risk.level === 'critical'
                          ? {border: 'border-l-[#E05252]', text: 'text-[#E05252]', bg: 'bg-red-100', badge: 'Needs Action'}
                          : risk.level === 'attention'
                          ? {border: 'border-l-[#D97706]', text: 'text-[#D97706]', bg: 'bg-amber-100', badge: 'Advisory'}
                          : {border: 'border-l-brand-teal', text: 'text-brand-teal', bg: 'bg-teal-50', badge: 'Synced'};
                      return (
                        <div
                          key={risk.item}
                          className={`border-l-4 ${color.border} bg-stone-50 p-4 rounded-r-sm flex flex-col sm:flex-row items-start justify-between gap-3`}
                        >
                          <div>
                            <span className={`inline-block text-[10px] font-mono font-bold uppercase ${color.text} tracking-wider mb-1`}>
                              {risk.level} · {risk.item}
                            </span>
                            <p className="text-sm font-medium text-brand-charcoal">
                              {risk.reason}
                            </p>
                          </div>
                          <span className={`text-xs px-2.5 py-1 ${color.bg} ${color.text} font-semibold rounded text-center whitespace-nowrap sm:ml-4`}>
                            {color.badge}
                          </span>
                        </div>
                      );
                    })
                  : (
                    <>
                {/* Critical Risk: Red Border #E05252 */}
                <div className="border-l-4 border-l-[#E05252] bg-stone-50 p-4 rounded-r-sm flex flex-col sm:flex-row items-start justify-between gap-3">
                  <div>
                    <span className="inline-block text-[10px] font-mono font-bold uppercase text-[#E05252] tracking-wider mb-1">
                      Critical · Overdue Promise
                    </span>
                    <p className="text-sm font-medium text-brand-charcoal">
                      Pending Security Spec — Promised deliverable overdue by 4 days.
                    </p>
                    <p className="text-xs text-brand-slateText mt-1">
                      Stated commitment to Priya on Oct 16: &ldquo;You will have the revised VPC architecture PDF by Friday&rdquo;.
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-red-100 text-[#E05252] font-semibold rounded text-center whitespace-nowrap sm:ml-4">
                    Needs Action
                  </span>
                </div>

                {/* Attention Risk: Amber Border #D97706 */}
                <div className="border-l-4 border-l-[#D97706] bg-stone-50 p-4 rounded-r-sm flex flex-col sm:flex-row items-start justify-between gap-3">
                  <div>
                    <span className="inline-block text-[10px] font-mono font-bold uppercase text-[#D97706] tracking-wider mb-1">
                      Attention · Budget Friction
                    </span>
                    <p className="text-sm font-medium text-brand-charcoal">
                      Budget Reallocation — Meera expressed concern regarding Q4 infra charges.
                    </p>
                    <p className="text-xs text-brand-slateText mt-1">
                      Recommended counter-strategy: Lead with the multi-cluster consolidation savings.
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-amber-100 text-[#D97706] font-semibold rounded text-center whitespace-nowrap sm:ml-4">
                    Advisory
                  </span>
                </div>

                {/* Normal Item: Green/Teal Border #4A7A84 */}
                <div className="border-l-4 border-l-brand-teal bg-stone-50 p-4 rounded-r-sm flex flex-col sm:flex-row items-start justify-between gap-3">
                  <div>
                    <span className="inline-block text-[10px] font-mono font-bold uppercase text-brand-teal tracking-wider mb-1">
                      Verified · On Track
                    </span>
                    <p className="text-sm font-medium text-brand-charcoal">
                      Quarterly Roadmap Alignment Verified.
                    </p>
                    <p className="text-xs text-brand-slateText mt-1">
                      All engineering prerequisites for migration sprint are acknowledged and scheduled.
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-teal-50 text-brand-teal font-semibold rounded text-center whitespace-nowrap sm:ml-4">
                    Synced
                  </span>
                </div>
                    </>
                  ))}
              </div>
              {risksError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
                  {risksError}
                </p>
              )}
            </div>

            {/* MODULE D: Practice This Meeting (Simulator) */}
            <div
              className="bg-white p-6 sm:p-8 rounded-sm border border-stone-200 shadow-sm space-y-6"
              data-purpose="simulator-module"
            >
              <div className="flex items-center justify-between pb-4 border-b border-stone-100">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-architectural text-brand-teal">
                    Phase 03
                  </span>
                  <h3 className="text-xl font-normal text-brand-charcoal">
                    Practice This Meeting (AI Simulation)
                  </h3>
                </div>
                <span className="text-xs px-2.5 py-1 bg-brand-sand text-brand-charcoal rounded font-mono font-medium">
                  Session Live
                </span>
              </div>

              {/* Simulation Chat Window */}
              <div className="bg-[#F8F9FA] p-6 rounded-sm border border-stone-200 space-y-4">
                {simChat.length === 0 && (
                  <p className="text-xs text-stone-500 italic">
                    Press Send to open the conversation — the contact will greet you based on real memory.
                  </p>
                )}
                {simChat.map((turn, idx) =>
                  turn.role === 'contact' ? (
                    /* Contact Message (Left Bubble) */
                    <div key={idx} className="flex items-start gap-3 max-w-lg">
                      <div className="w-8 h-8 rounded-full bg-stone-300 flex items-center justify-center text-xs font-semibold text-stone-700 flex-shrink-0">
                        {activeContact
                          .split(' ')
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </div>
                      <div className="bg-white p-4 rounded-lg rounded-tl-none border border-stone-200 shadow-xs">
                        <p className="text-xs font-semibold text-stone-800 mb-1">
                          {activeContact}
                        </p>
                        <p className="text-sm text-stone-700">{turn.content}</p>
                      </div>
                    </div>
                  ) : (
                    /* User Response (Right Bubble) with Inline Coaching Feedback */
                    <div key={idx} className="flex flex-col items-end space-y-2">
                      <div className="flex items-start gap-3 max-w-lg justify-end">
                        <div className="bg-brand-teal text-white p-4 rounded-lg rounded-tr-none shadow-sm">
                          <p className="text-xs font-medium text-brand-tealLight/80 mb-1 text-right">
                            You (Alex)
                          </p>
                          <p className="text-sm">{turn.content}</p>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-brand-charcoal flex items-center justify-center text-xs font-semibold text-white flex-shrink-0">
                          ME
                        </div>
                      </div>
                      {turn.feedback && (
                        <div className="sm:mr-11 bg-amber-50 border border-amber-200/80 px-3.5 py-1.5 rounded-full text-xs text-amber-900 flex items-center gap-1.5 shadow-2xs">
                          <span>💡</span>
                          <span className="italic">{turn.feedback}</span>
                        </div>
                      )}
                    </div>
                  )
                )}
                {simLoading && (
                  <div className="flex items-center gap-2 text-xs text-stone-500">
                    <svg
                      className="animate-spin h-3.5 w-3.5 text-stone-500"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        fill="currentColor"
                      ></path>
                    </svg>
                    {activeContact.split(' ')[0]} is thinking...
                  </div>
                )}
              </div>

              {/* Dialogue Input Area */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={simulationReply}
                  onChange={(e) => setSimulationReply(e.target.value)}
                  placeholder="Type your reply to simulate Priya's reaction..."
                  className="flex-1 text-sm bg-stone-50 border border-stone-300 rounded-sm py-2.5 px-4 focus:outline-none focus:ring-1 focus:ring-brand-teal focus:border-brand-teal"
                />
                <button
                  type="button"
                  onClick={() => {
                    handleSendSimulation();
                  }}
                  className="px-6 py-2.5 bg-brand-teal hover:bg-brand-tealDark text-white text-xs font-medium tracking-editorial uppercase rounded-sm transition-colors cursor-pointer inline-flex items-center gap-2"
                >
                  {simLoading && <Spinner />}
                  Send
                </button>
              </div>
              {simError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
                  {simError}
                </p>
              )}
            </div>

            {/* MODULE E: Log This Meeting (Commitment Extractor) */}
            <div
              className="bg-white p-6 sm:p-8 rounded-sm border border-stone-200 shadow-sm space-y-6"
              data-purpose="extractor-module"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-stone-100">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-architectural text-brand-teal">
                    Phase 04
                  </span>
                  <h3 className="text-xl font-normal text-brand-charcoal">
                    Post-Call Commitment Extraction
                  </h3>
                </div>
                <span className="text-xs text-stone-500 font-mono">
                  Engine: Hindsight-NLP v4
                </span>
              </div>

              {/* Input Textarea for Notes/Transcript */}
              <div>
                <label className="block text-xs uppercase tracking-architectural font-medium text-brand-charcoal mb-2">
                  Paste your meeting notes or raw transcript:
                </label>
                <textarea
                  rows={4}
                  value={meetingNotes}
                  onChange={(e) => setMeetingNotes(e.target.value)}
                  className="w-full text-xs sm:text-sm font-mono text-stone-700 bg-stone-50 border border-stone-300 rounded-sm p-3.5 focus:outline-none focus:ring-1 focus:ring-brand-teal focus:border-brand-teal leading-relaxed"
                />
              </div>

              {/* Action Button with Loading Representation */}
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    handleExtractCommitments();
                  }}
                  className="px-6 py-2.5 bg-brand-teal hover:bg-brand-tealDark text-white text-xs font-medium tracking-editorial uppercase rounded-sm flex items-center gap-2 shadow-sm cursor-pointer transition-colors"
                >
                  {extractLoading ? (
                    <Spinner />
                  ) : (
                    <svg
                      className="h-3.5 w-3.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        fill="currentColor"
                      ></path>
                    </svg>
                  )}
                  Extract commitments
                </button>
                <span className="text-xs text-stone-500">
                  {commitments
                    ? `${commitments.length} commitment${commitments.length === 1 ? '' : 's'} identified with high confidence`
                    : '2 commitments identified with high confidence'}
                </span>
              </div>
              {extractError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
                  {extractError}
                </p>
              )}

              {/* Sleek Editable Commitments Table */}
              <div className="overflow-x-auto border border-stone-200 rounded-sm">
                <table className="min-w-full divide-y divide-stone-200 text-left">
                  <thead className="bg-stone-50 text-[11px] font-mono uppercase tracking-wider text-stone-500">
                    <tr>
                      <th className="py-3 px-4" scope="col">
                        Owner
                      </th>
                      <th className="py-3 px-4" scope="col">
                        Action Item
                      </th>
                      <th className="py-3 px-4" scope="col">
                        Deadline
                      </th>
                      <th className="py-3 px-4" scope="col">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 text-xs text-brand-charcoal bg-white">
                    {(commitments ?? [
                      {owner: 'Alex', action: 'Send updated SLA documentation', deadline: 'Oct 24, 2025'},
                      {owner: 'Priya', action: 'Review auth migration milestones', deadline: 'Oct 28, 2025'},
                    ]).map((c, idx) => (
                      <tr key={idx}>
                        <td className="py-3 px-4 font-semibold text-brand-teal">
                          {c.owner === 'you' ? 'You' : c.owner}
                        </td>
                        <td className="py-3 px-4">{c.action}</td>
                        <td className="py-3 px-4 font-mono">{c.deadline ?? '—'}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                            Open
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom Action & Confirmation State */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => {
                    handleSaveToMemory();
                  }}
                  className="px-6 py-2.5 bg-stone-900 hover:bg-black text-white text-xs font-semibold tracking-architectural uppercase rounded-sm shadow-sm transition-colors cursor-pointer self-start sm:self-auto inline-flex items-center gap-2"
                >
                  {saveLoading && <Spinner />}
                  Save to memory
                </button>
                {savedToMemory && (
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 px-4 py-2 rounded-sm border border-emerald-200">
                    <span>✓</span>
                    <span>Commitments saved to MeetMind persistent memory.</span>
                  </div>
                )}
              </div>
              {saveError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
                  {saveError}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
      {/* END: InteractiveDemoSection */}

      {/* BEGIN: MemorySection */}
      <section
        className="py-28 bg-brand-surface relative border-t border-brand-sand"
        id="memory"
      >
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-xl mx-auto mb-16">
            <span className="text-xs font-semibold tracking-architectural uppercase text-brand-teal block mb-3">
              The Cognitive Edge
            </span>
            <h2 className="text-3xl font-light text-brand-charcoal tracking-tight">
              Memory transforms generic conversation into durable trust.
            </h2>
          </div>

          {/* Architectural Split Contrast Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 rounded-sm overflow-hidden border border-stone-200 shadow-sm">
            {/* Without Memory */}
            <div className="p-8 sm:p-12 bg-white flex flex-col justify-between border-b md:border-b-0 md:border-r border-stone-200">
              <div>
                <div className="text-xs uppercase tracking-architectural font-mono text-stone-400 mb-6">
                  WITHOUT MEMORY
                </div>
                <p className="text-2xl font-light text-stone-400 leading-snug">
                  &ldquo;Generic advice, repeated questions, forgotten promises, and lost leverage.&rdquo;
                </p>
              </div>
              <div className="mt-8 pt-6 border-t border-stone-100 text-xs text-stone-400 font-mono">
                Status: Friction &amp; degraded credibility
              </div>
            </div>

            {/* With Memory */}
            <div className="p-8 sm:p-12 bg-[#F6F8F8] flex flex-col justify-between relative">
              <div className="absolute top-0 right-0 w-24 h-24 bg-brand-teal/5 rounded-bl-full pointer-events-none"></div>
              <div>
                <div className="text-xs uppercase tracking-architectural font-mono text-brand-teal font-semibold mb-6">
                  WITH MEETMIND
                </div>
                <p className="text-2xl font-normal text-brand-charcoal leading-snug">
                  &ldquo;You promised Priya the security document, and she&apos;s still waiting.&rdquo;
                </p>
              </div>
              <div className="mt-8 pt-6 border-t border-brand-teal/20 text-xs text-brand-teal font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-teal"></span>
                Precision continuity across every relationship.
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* END: MemorySection */}

      {/* BEGIN: MainFooter */}
      <footer className="bg-brand-charcoal text-white py-16 border-t border-stone-800">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div>
            <span className="text-xl font-light tracking-editorial uppercase text-white block">
              meet<span className="font-semibold text-brand-wood">mind</span>
            </span>
            <p className="text-xs text-stone-400 mt-2 font-mono">
              Built with Hindsight by Vectorize · Tokyo / San Francisco
            </p>
          </div>
          <div className="flex flex-wrap gap-8 text-xs font-mono tracking-wider text-stone-400">
            <a className="hover:text-white transition-colors" href="#start">
              START
            </a>
            <a className="hover:text-white transition-colors" href="#how">
              PRINCIPLES
            </a>
            <a className="hover:text-white transition-colors" href="#app">
              WORKSPACE
            </a>
            <a className="hover:text-white transition-colors" href="#memory">
              RECALL
            </a>
          </div>
          <div className="text-xs text-stone-500 font-mono">
            © 2026 MeetMind Systems. All rights reserved.
          </div>
        </div>
      </footer>
      {/* END: MainFooter */}
    </div>
  );
}
