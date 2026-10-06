import hashlib
import json
import os
import re
import time
from pathlib import Path

import requests
import streamlit as st
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BACKEND_URL = os.environ.get("AGENT_BACKEND_URL", "http://localhost:3334")
TYPE_DELAY_PER_WORD = 0.045

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
      .thinking { display: flex; align-items: center; gap: 10px; color: #8990a8; font-size: 14px; padding: 4px 0; }
      .thinking .spinner-dots { display: inline-flex; gap: 4px; align-items: center; }
      .thinking .spinner-dots span {
        width: 6px; height: 6px; border-radius: 50%;
        animation: dot-bounce 1.1s infinite ease-in-out both;
      }
      .thinking .spinner-dots span:nth-child(1) { background: #6d8cff; animation-delay: -0.26s; }
      .thinking .spinner-dots span:nth-child(2) { background: #9bb0ff; animation-delay: -0.13s; }
      .thinking .spinner-dots span:nth-child(3) { background: #2fd99f; animation-delay: 0s; }
      @keyframes dot-bounce {
        0%, 70%, 100% { transform: translateY(0) scale(0.85); opacity: 0.5; }
        35% { transform: translateY(-5px) scale(1.05); opacity: 1; }
      }
    </style>
    <div class="badge"><span class="dot"></span>Live agent</div>
    """,
    unsafe_allow_html=True,
)
st.title("Meeting Pipeline")
st.caption("Voice-turn agent · real MCP server · real Linear / Notion / Slack calls")

if "exchanges" not in st.session_state:
    st.session_state.exchanges = []
if "last_audio_hash" not in st.session_state:
    st.session_state.last_audio_hash = None
if "audio_key" not in st.session_state:
    st.session_state.audio_key = 0
if "clear_transcript" not in st.session_state:
    st.session_state.clear_transcript = False

if st.session_state.clear_transcript:
    st.session_state["transcript_box"] = ""
    st.session_state.clear_transcript = False

log_container = st.container()


def render_tail(turns):
    tool_turns = [t for t in turns if t.get("type") in ("tool_call", "tool_result")]
    final_turn = next((t for t in turns if t.get("type") == "final"), None)
    error_turn = next((t for t in turns if t.get("type") == "error"), None)

    if tool_turns:
        call_count = sum(1 for t in tool_turns if t.get("type") == "tool_call")
        with st.expander(f"\U0001F6E0️ {call_count} tool call(s)", expanded=False):
            for t in tool_turns:
                if t["type"] == "tool_call":
                    st.markdown(f"**Calling `{t['tool']}`**")
                    st.code(json.dumps(t["args"], indent=2), language="json")
                else:
                    st.markdown(f"**{t['tool']} result**" + (" ❌" if t.get("isError") else " ✅"))
                    result = t["result"]
                    if isinstance(result, (dict, list)):
                        st.code(json.dumps(result, indent=2), language="json")
                    else:
                        st.write(result)

    if final_turn:
        with st.chat_message("assistant", avatar="\U0001F916"):
            st.success(final_turn["text"])
    if error_turn:
        with st.chat_message("assistant", avatar="⚠️"):
            st.error(error_turn["text"])


def render_exchange(user_text, turns):
    with st.chat_message("user"):
        st.write(user_text)
    render_tail(turns)


# --- input composer (below the log, per layout preference) ---

audio = st.audio_input(
    "Record meeting notes (transcribed by Groq Whisper)",
    key=f"audio_input_{st.session_state.audio_key}",
)
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
                    st.session_state["transcript_box"] = text
            except requests.RequestException as err:
                st.error(f"Transcription failed: {err}")

transcript = st.text_area(
    "Meeting notes",
    key="transcript_box",
    height=140,
    placeholder="Paste or record meeting notes...",
)

col1, col2 = st.columns([1, 1])
send_clicked = col1.button("Send to agent", type="primary", use_container_width=True)
clear_clicked = col2.button("Clear conversation", use_container_width=True)

if clear_clicked:
    st.session_state.exchanges = []
    st.session_state.audio_key += 1
    st.session_state.last_audio_hash = None
    st.session_state.clear_transcript = True
    st.rerun()

did_animate = False

if send_clicked:
    user_text = transcript.strip()
    if not user_text:
        st.warning("Write or record some meeting notes first.")
    else:
        did_animate = True
        with log_container:
            for exchange in st.session_state.exchanges:
                render_exchange(exchange["user"], exchange["turns"])

            with st.chat_message("user"):
                placeholder = st.empty()
                shown = ""
                for token in re.split(r"(\s+)", user_text):
                    shown += token
                    placeholder.write(shown + "▌")
                    if token.strip():
                        time.sleep(TYPE_DELAY_PER_WORD)
                placeholder.write(user_text)

            with st.chat_message("assistant", avatar="\U0001F916"):
                thinking = st.empty()
                dots = '<span class="spinner-dots"><span></span><span></span><span></span></span>'
                thinking.markdown(
                    f'<div class="thinking">{dots}Working on it...</div>',
                    unsafe_allow_html=True,
                )
                turns = []
                try:
                    resp = requests.post(
                        f"{BACKEND_URL}/api/voice-turn",
                        json={"transcript": user_text},
                        stream=True,
                        timeout=(10, 90),
                    )
                    resp.raise_for_status()
                    step = 0
                    for line in resp.iter_lines(decode_unicode=True):
                        if not line:
                            continue
                        turn = json.loads(line)
                        turns.append(turn)
                        if turn["type"] == "tool_call":
                            step += 1
                            thinking.markdown(
                                f'<div class="thinking">{dots}'
                                f"Working... step {step}: {turn['tool']}</div>",
                                unsafe_allow_html=True,
                            )
                except requests.RequestException as err:
                    turns.append({"type": "error", "text": str(err)})
                thinking.empty()

            render_tail(turns)

        st.session_state.exchanges.append({"user": user_text, "turns": turns})
        st.session_state.audio_key += 1
        st.session_state.last_audio_hash = None
        st.session_state.clear_transcript = True
        st.rerun()

if not did_animate:
    with log_container:
        for exchange in st.session_state.exchanges:
            render_exchange(exchange["user"], exchange["turns"])
