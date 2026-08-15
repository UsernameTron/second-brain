import React, { useRef, useState } from 'react';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
    </svg>
  );
}

const CMD_MODES = [
  { key: 'ask', label: 'Ask', hint: 'read-only — answer with evidence' },
  { key: 'act', label: 'Act', hint: 'normal run — may draft and hand off' },
  { key: 'rehearse', label: 'Rehearse', hint: 'dry run — narrates, changes nothing' },
];

export default function CommandBar({ paused, onParse, onConfirm, toast }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState('act');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // { intent, text }
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  const submit = async (raw) => {
    const value = String(raw !== undefined ? raw : text).trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const intent = await onParse(value, mode);
      setPending({ intent, text: value });
      setText('');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      // The CURRENT mode wins, not the snapshot captured at parse time — a
      // user who flips to Ask while the confirm is open means Ask.
      await onConfirm({ ...pending.intent, mode });
      setPending(null);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (!SR) return;
    if (listening) {
      try { recRef.current?.stop(); } catch { /* noop */ }
      return;
    }
    const rec = new SR();
    recRef.current = rec;
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (const r of e.results) {
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText(finalText || interim);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) submit(finalText);
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error && e.error !== 'aborted' && e.error !== 'no-speech') toast(`voice: ${e.error}`);
    };
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };

  const unknown = pending && pending.intent.action === 'unknown';

  return (
    <div className="cmdbar">
      {pending ? (
        <div className={`intent-echo ${unknown ? 'intent-error' : ''}`}>
          <span className="intent-arrow">→</span>
          <div className="intent-text">
            <div className="intent-main">{pending.intent.echo || pending.intent.instruction || pending.text}</div>
            {!unknown && (pending.intent.agent_name || pending.intent.action !== 'dispatch') ? (
              <div className="intent-detail mono">
                {pending.intent.action}
                {` · ${mode.toUpperCase()}`}
                {pending.intent.agent_name ? ` · ${pending.intent.agent_name}` : ''}
                {pending.intent.instruction ? ` — ${pending.intent.instruction}` : ''}
              </div>
            ) : null}
          </div>
          {!unknown ? (
            <button className="btn ok small" disabled={busy} onClick={confirm}>Confirm</button>
          ) : null}
          <button className="btn ghost small" onClick={() => setPending(null)}>{unknown ? 'Dismiss' : 'Cancel'}</button>
        </div>
      ) : null}
      <form className="cmd-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="mode-switch cmd-modes" role="radiogroup" aria-label="Run mode">
          {CMD_MODES.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
              className={`btn ghost small ${mode === m.key ? 'lens-on' : ''}`} title={m.hint}
              onClick={() => setMode(m.key)}>{m.label}</button>
          ))}
        </div>
        <button
          type="button"
          className={`mic-btn ${listening ? 'listening' : ''}`}
          disabled={!SR}
          title={SR ? (listening ? 'Stop listening' : 'Speak a command') : 'Voice input is unavailable in this browser'}
          aria-label={listening ? 'Stop listening' : 'Speak a command'}
          aria-pressed={listening}
          onClick={toggleMic}
        >
          <MicIcon />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={listening ? 'Listening…' : 'Tell an agent what to do — "have Scout re-check rows 3–5"'}
        />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
      {paused ? <div className="cmd-paused-hint">workspace paused — dispatch will be rejected until resume</div> : null}
    </div>
  );
}
