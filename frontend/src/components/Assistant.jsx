import { useEffect, useRef, useState } from 'react';
import { useBusiness } from '../lib/BusinessContext.jsx';
import { apiPost, notifyDataChanged } from '../lib/api.js';

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});
const REC_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
import { uploadImage } from '../lib/images.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const STORE_KEY = 'stockfacil-chat';

const SUGGESTIONS = [
  '¿Cómo vengo este mes?',
  'Vendí 2 de ',
  '¿Qué productos tienen stock bajo?',
  'Pagué 3500 de envío',
  'Me llegaron 10 unidades de ',
];

const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } };
const save = (m) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(m.slice(-40))); } catch { /* sin storage */ } };

/** Markdown mínimo: **negrita**, listas con "- " y saltos de línea */
function Rich({ text }) {
  return String(text).split('\n').map((line, i) => {
    const bullet = /^\s*[-•*]\s+/.test(line);
    const clean = line.replace(/^\s*[-•*]\s+/, '');
    const parts = clean.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (
      p.startsWith('**') && p.endsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : <span key={j}>{p}</span>
    ));
    return <div key={i} className={bullet ? 'md-li' : 'md-p'}>{bullet && '• '}{parts}{!clean && ' '}</div>;
  });
}

export default function Assistant({ open, onClose }) {
  const { business } = useBusiness();
  const [messages, setMessages] = useState(load);
  const [input, setInput] = useState('');
  const [photo, setPhoto] = useState(null); // { url, preview }
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const recRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { save(messages); }, [messages]);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [messages, busy, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  async function send(textArg) {
    const text = (textArg ?? input).trim();
    if ((!text && !photo) || busy) return;
    setError('');
    const userMsg = { role: 'user', content: text, image: photo?.url };
    const history = messages.map(({ role, content, image }) => ({ role, content: (image ? '[foto] ' : '') + content }));
    setMessages((m) => [...m, userMsg]);
    setInput('');
    const imageUrl = photo?.url;
    setPhoto(null);
    setBusy(true);
    try {
      const out = await apiPost('/api/chat', { message: text, history, image_url: imageUrl });
      setMessages((m) => [...m, { role: 'assistant', content: out.reply }]);
      if (out.changed) notifyDataChanged();
    } catch (e) {
      setError(e.message);
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  // Plan B sin dictado del navegador: graba el audio y lo transcribe el servidor (IA gratuita)
  async function toggleRecorder() {
    if (listening) { recRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no permite grabar audio. Usá el micrófono del teclado del celular.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = REC_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
        if (blob.size < 2000) return;
        setInput('Transcribiendo audio…');
        try {
          const { text } = await apiPost('/api/transcribe', { audio_base64: await blobToBase64(blob), mime: blob.type });
          setInput('');
          if (text) send(text);
        } catch (err) {
          setInput('');
          setError(err.message);
        }
      };
      recRef.current = rec;
      setError('');
      setListening(true);
      rec.start();
      setTimeout(() => rec.state === 'recording' && rec.stop(), 60000); // máx 1 minuto
    } catch {
      setError('Permití el uso del micrófono en el navegador.');
    }
  }

  function toggleMic() {
    if (!SR) { toggleRecorder(); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = 'es-AR';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') setError('Permití el uso del micrófono en el navegador.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError('Error de dictado: ' + e.error);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) send(finalText.trim()); // al terminar de hablar se envía solo
    };
    recRef.current = rec;
    setError('');
    setListening(true);
    rec.start();
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setError('');
    try {
      const preview = URL.createObjectURL(file);
      const url = await uploadImage(business.id, file, 'chat');
      setPhoto({ url, preview });
      inputRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function clear() {
    if (messages.length && !confirm('¿Borrar la conversación?')) return;
    setMessages([]);
  }

  if (!open) return null;

  return (
    <div className="assistant" role="dialog" aria-label="Asistente">
      <div className="assistant-head">
        <div>
          <div className="strong">✨ Asistente</div>
          <div className="muted small">Escribí, hablá o mandá una foto</div>
        </div>
        <div className="row-inline">
          <button className="icon-btn" title="Nueva conversación" onClick={clear}>🗑</button>
          <button className="icon-btn" title="Cerrar" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="assistant-body" ref={listRef}>
        {messages.length === 0 && (
          <div className="assistant-empty">
            <p className="muted">Pedime lo que necesites. Por ejemplo:</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => { setInput(s); inputRef.current?.focus(); }}>{s}</button>
              ))}
              <button className="chip" onClick={() => fileRef.current?.click()}>📷 Reconocer un artículo por foto</button>
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role === 'assistant' ? 'bot' : 'me'}${m.error ? ' err' : ''}`}>
            {m.image && <img src={m.image} alt="" className="bubble-img" />}
            {m.content && <Rich text={m.content} />}
          </div>
        ))}
        {busy && <div className="bubble bot typing"><span /><span /><span /></div>}
      </div>

      {error && <div className="assistant-error">{error}</div>}

      {(photo || uploading) && (
        <div className="photo-preview">
          {uploading ? <span className="muted small">Subiendo foto…</span> : (
            <>
              <img src={photo.preview} alt="" />
              <span className="muted small">Foto lista. Decime qué hacer (o enviá así para reconocerla).</span>
              <button className="icon-btn" onClick={() => setPhoto(null)}>✕</button>
            </>
          )}
        </div>
      )}

      <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPickPhoto} />
        <button type="button" className="icon-btn big" title="Foto" onClick={() => fileRef.current?.click()} disabled={uploading}>📷</button>
        <button type="button" className={`icon-btn big${listening ? ' rec' : ''}`} title={listening ? 'Detener' : 'Hablar'} onClick={toggleMic}>
          {listening ? '⏺' : '🎙️'}
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={listening ? 'Escuchando…' : 'Ej: vendí 3 velas de soja'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn primary" disabled={busy || uploading || (!input.trim() && !photo)}>Enviar</button>
      </form>
    </div>
  );
}
