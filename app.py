"""Meeting Prep Agent — Streamlit UI.

Run:
    streamlit run app.py
"""

from __future__ import annotations

import agent
import streamlit as st

st.set_page_config(page_title="Meeting Prep Agent", page_icon="📅", layout="centered")

st.title("📅 Meeting Prep Agent")
st.caption("Powered by Hindsight Cloud memory + Groq (openai/gpt-oss-120b)")

# --- Sidebar: contact picker + memory toggle ---------------------------------
with st.sidebar:
    st.header("Settings")
    contact = st.selectbox("Contact", agent.CONTACTS)

    use_memory = st.toggle("Memory ON", value=True, help="When ON, prep briefs are grounded in your saved meeting notes (via Hindsight). When OFF, you get a generic brief.")

    st.divider()
    st.subheader("Add meeting notes")
    note_text = st.text_area(
        "Notes",
        height=140,
        placeholder=f"e.g. Met with {contact} on ... Discussed ... I promised ... Open items: ...",
        key="note_text",
    )
    save_clicked = st.button("💾 Save notes", type="primary", use_container_width=True)

if save_clicked:
    if not note_text.strip():
        st.sidebar.warning("Write some notes first.")
    else:
        try:
            agent.add_note(contact, note_text)
            st.sidebar.success(f"Saved to memory for {contact}.")
            st.session_state.note_text = ""
        except RuntimeError as exc:
            st.sidebar.error(f"Couldn't save your note: {exc}")
        except ValueError:
            st.sidebar.warning("Write some notes first.")

# --- Main: prep brief --------------------------------------------------------
st.subheader(f"Prep brief — {contact}")
if not use_memory:
    st.info("Memory is OFF — the brief will be generic, without your saved notes.", icon="🧠")

if st.button("🚀 Prep me", type="primary", use_container_width=False):
    with st.spinner("Consulting memory and drafting your brief..." if use_memory else "Drafting a generic brief..."):
        try:
            brief_text = agent.brief(contact, use_memory)
        except RuntimeError as exc:
            st.error(f"Something went wrong: {exc}", icon="⚠️")
        else:
            st.markdown(brief_text)
            st.download_button(
                "⬇️ Download brief",
                data=brief_text,
                file_name=f"prep-brief-{contact.lower().replace(' ', '-')}.md",
                mime="text/markdown",
            )
else:
    st.markdown(
        "Pick a contact, flip **Memory ON** or OFF, then hit **Prep me**.\n\n"
        "Sections: *What we discussed · What I promised · Still open · Talking points*"
    )
