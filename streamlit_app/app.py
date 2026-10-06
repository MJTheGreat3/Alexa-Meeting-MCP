import hashlib
import json
import os
from pathlib import Path

import requests
import streamlit as st
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BACKEND_URL = os.environ.get("ROUTE_B_BACKEND_URL", "http://localhost:3334")

SAMPLE_TRANSCRIPT = """Standup - Oct 6
Priya: Checkout page still throws a 500 when the cart is empty, need someone on that today.
Dev: I'll also write up the API rate-limit doc so support stops getting paged for it.
Priya: And can someone ping the team once both are filed so folks know to stop retrying?"""

st.set_page_config(page_title="Meeting Pipeline", page_icon="\U0001F399️", layout="centered")

st.markdown(
    """
    <style>
      .badge {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
        color: #2fd99f; background: rgba(47,217,159,0.1);
        border: 1px solid rgba(47,217,159,0.25); border-radius: 999px;
        padding: 4px 10px; margin-bottom: 10px;
      }
      .badge .dot { width: 6px; height: 6px; border-radius: 50%; background: #2fd99f;
        display: inline-block; box-shadow: 0 0 8px #2fd99f; }
      h1 { font-weight: 700 !important; letter-spacing: -0.02em; }
    </style>
    <div class="badge"><span class="dot"></span>Route B &middot; live demo</div>
    """,
    unsafe_allow_html=True,
)
st.title("Meeting Pipeline")
st.caption("Simulated Alexa+ voice turn · real MCP server · real Linear / Notion / Slack calls")

if "messages" not in st.session_state:
    st.session_state.messages = []
if "transcript" not in st.session_state:
    st.session_state.transcript = SAMPLE_TRANSCRIPT
if "last_audio_hash" not in st.session_state:
    st.session_state.last_audio_hash = None

audio = st.audio_input("Record meeting notes (transcribed by Groq Whisper)")
if audio is not None:
    audio_bytes = audio.getvalue()
    audio_hash = hashlib.sha256(audio_bytes).hexdigest()
    if audio_hash != st.session_state.last_audio_hash:
        st.session_state.last_audio_hash = audio_hash
        with st.spinner("Transcribing..."):
            try:
                resp = requests.post(
                    f"{BACKEND_URL}/api/transcribe",
                    data=audio_bytes,
                    headers={"Content-Type": "audio/wav"},
                    timeout=60,
                )
                resp.raise_for_status()
                text = resp.json().get("text", "").strip()
                if text:
                    st.session_state.transcript = text
            except requests.RequestException as err:
                st.error(f"Transcription failed: {err}")

transcript = st.text_area(
    "Meeting notes",
    key="transcript",
    height=140,
    placeholder="Paste or record meeting notes...",
)

col1, col2 = st.columns([1, 1])
send_clicked = col1.button("Send to agent", type="primary", use_container_width=True)
clear_clicked = col2.button("Clear conversation", use_container_width=True)

if clear_clicked:
    st.session_state.messages = []
    st.rerun()

if send_clicked:
    text = transcript.strip()
    if not text:
        st.warning("Write or record some meeting notes first.")
    else:
        st.session_state.messages.append({"role": "user", "text": text})
        with st.spinner("Agent is working..."):
            try:
                resp = requests.post(
                    f"{BACKEND_URL}/api/voice-turn",
                    json={"transcript": text},
                    timeout=120,
                )
                resp.raise_for_status()
                data = resp.json()
                for turn in data.get("turns", []):
                    st.session_state.messages.append(turn)
            except requests.RequestException as err:
                st.session_state.messages.append({"type": "error", "text": str(err)})
        st.rerun()

for msg in st.session_state.messages:
    if msg.get("role") == "user":
        with st.chat_message("user"):
            st.write(msg["text"])
    elif msg.get("type") == "tool_call":
        with st.chat_message("assistant", avatar="\U0001F6E0️"):
            st.markdown(f"**Calling `{msg['tool']}`**")
            st.code(json.dumps(msg["args"], indent=2), language="json")
    elif msg.get("type") == "tool_result":
        avatar = "❌" if msg.get("isError") else "✅"
        with st.chat_message("assistant", avatar=avatar):
            st.markdown(f"**{msg['tool']} result**")
            result = msg["result"]
            if isinstance(result, (dict, list)):
                st.code(json.dumps(result, indent=2), language="json")
            else:
                st.write(result)
    elif msg.get("type") == "final":
        with st.chat_message("assistant", avatar="\U0001F916"):
            st.success(msg["text"])
    elif msg.get("type") == "error":
        with st.chat_message("assistant", avatar="⚠️"):
            st.error(msg["text"])
