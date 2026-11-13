import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  ExternalLink,
  Globe,
  MapPin,
  Mic,
  MicOff,
  PhoneCall,
  Send,
  Volume2,
  X,
} from 'lucide-react';
import type { GroundingMode, LanguageCode, MapGroundingLink, WebGroundingLink } from '../../../shared/types';
import { TRANSLATIONS } from '../../i18n/translations';
import { apiFetch } from '../../lib/api';
import { useAppData } from '../auth/AuthContext';

interface ChatTurn {
  role: 'user' | 'model';
  text: string;
  groundingLinks?: MapGroundingLink[];
  webSources?: WebGroundingLink[];
  groundingUsed?: 'maps' | 'search' | 'none';
}

interface VoiceTurn {
  id: string;
  speaker: 'you' | 'assistant';
  text: string;
}

type DrawerMode = 'text' | 'voice';
type VoiceStatus = 'idle' | 'connecting' | 'live' | 'error';

function float32ToPcm16Base64(input: Float32Array): string {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const samples = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export const RescueChatDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  lang: LanguageCode;
}> = ({ open, onClose, lang }) => {
  const { user } = useAppData();
  const t = TRANSLATIONS[lang];

  const [mode, setMode] = useState<DrawerMode>('text');
  const [groundingMode, setGroundingMode] = useState<GroundingMode>('auto');
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      role: 'model',
      text: 'Hello, I am the DisasterGuard Assam Rescue Assistant. Ask me for flood/earthquake/landslide safety steps, nearby hospitals/shelters via Google Maps, or live Assam weather & ASDMA advisories via Google Search.',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Live Voice state & refs (mutable audio objects kept strictly in refs)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // Fetch coarse location silently if already granted for Maps Grounding context
  useEffect(() => {
    if (!open || !navigator.geolocation || !navigator.permissions) return;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((perm) => {
        if (perm.state === 'granted') {
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              setUserLocation({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              }),
            () => {},
            { maximumAge: 60000, timeout: 4000 }
          );
        }
      })
      .catch(() => {});
  }, [open]);

  const stopScheduledAudio = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore stopped source
      }
    }
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  }, []);

  const stopVoiceSession = useCallback(() => {
    stopScheduledAudio();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    setVoiceStatus('idle');
  }, [stopScheduledAudio]);

  useEffect(() => {
    if (!open) {
      stopVoiceSession();
    }
    return () => {
      stopVoiceSession();
    };
  }, [open, stopVoiceSession]);

  const play24kPcmChunk = useCallback((base64Audio: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;

    const floatData = pcm16Base64ToFloat32(base64Audio);
    if (floatData.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, floatData.length, 24000);
    audioBuffer.getChannelData(0).set(floatData);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
    };
  }, []);

  const startVoiceSession = async () => {
    if (voiceStatus === 'connecting' || voiceStatus === 'live') return;
    setVoiceError(null);
    setVoiceStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const districtParam = encodeURIComponent(user?.district || 'Kamrup Metropolitan');
      const ws = new WebSocket(
        `${proto}//${window.location.host}/ws/live?lang=${lang}&district=${districtParam}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (ev) => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) return;
          const channel = ev.inputBuffer.getChannelData(0);
          const audioBase64 = float32ToPcm16Base64(channel);
          wsRef.current.send(JSON.stringify({ audio: audioBase64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
        setVoiceStatus('live');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            ready?: boolean;
            audio?: string;
            interrupted?: boolean;
            inputTranscript?: string;
            outputTranscript?: string;
            error?: string;
          };

          if (msg.error) {
            setVoiceError(msg.error);
            setVoiceStatus('error');
            stopVoiceSession();
            return;
          }
          if (msg.interrupted) {
            stopScheduledAudio();
          }
          if (msg.audio) {
            play24kPcmChunk(msg.audio);
          }
          if (msg.inputTranscript) {
            setVoiceTurns((prev) => [
              ...prev.slice(-18),
              { id: `in-${Date.now()}-${Math.random()}`, speaker: 'you', text: msg.inputTranscript! },
            ]);
          }
          if (msg.outputTranscript) {
            setVoiceTurns((prev) => [
              ...prev.slice(-18),
              {
                id: `out-${Date.now()}-${Math.random()}`,
                speaker: 'assistant',
                text: msg.outputTranscript!,
              },
            ]);
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onerror = () => {
        setVoiceError('Live voice connection interrupted. Please try again or dial 112/1070.');
        setVoiceStatus('error');
      };

      ws.onclose = () => {
        setVoiceStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
      };
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : 'Microphone permission denied or audio unavailable.'
      );
      setVoiceStatus('error');
      stopVoiceSession();
    }
  };

  if (!open) return null;

  const sendMessage = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || sending) return;

    const nextHistory = [...messages, { role: 'user' as const, text: trimmed }];
    setMessages(nextHistory);
    setInput('');
    setSending(true);

    try {
      const res = await apiFetch<{
        reply: string;
        groundingLinks?: MapGroundingLink[];
        webSources?: WebGroundingLink[];
        groundingUsed?: 'maps' | 'search' | 'none';
      }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: trimmed,
          history: messages.map((m) => ({ role: m.role, text: m.text })),
          language: lang,
          district: user?.district || null,
          userLocation,
          groundingMode,
        }),
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: res.reply,
          groundingLinks: res.groundingLinks || [],
          webSources: res.webSources || [],
          groundingUsed: res.groundingUsed,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: `${err instanceof Error ? err.message : 'Assistant error.'} For urgent rescue, dial 112 or 1070 immediately.`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/55 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rescue-chat-title"
    >
      <div className="w-full sm:max-w-md h-[85vh] sm:h-[660px] rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="w-5 h-5 text-sky-500 shrink-0" aria-hidden="true" />
            <h2 id="rescue-chat-title" className="text-base font-bold text-slate-900 dark:text-white truncate">
              {t.rescueAssistant}
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  stopVoiceSession();
                  setMode('text');
                }}
                className={`min-h-[32px] px-2.5 rounded-lg font-semibold ${
                  mode === 'text'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => setMode('voice')}
                className={`min-h-[32px] px-2.5 rounded-lg font-semibold inline-flex items-center gap-1 ${
                  mode === 'voice'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Voice</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white"
              aria-label="Close rescue assistant"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Emergency Bar + Disclaimer */}
        <div className="px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 text-[11px] text-red-700 dark:text-red-300 space-y-1.5">
          <p>{t.disclaimer}</p>
          <div className="flex flex-wrap gap-2">
            <a href="tel:112" className="font-mono font-bold inline-flex items-center gap-1 underline">
              <PhoneCall className="w-3 h-3" /> 112 (Emergency)
            </a>
            <a href="tel:1070" className="font-mono font-bold inline-flex items-center gap-1 underline">
              <PhoneCall className="w-3 h-3" /> 1070 (ASDMA)
            </a>
            <a href="tel:108" className="font-mono font-bold inline-flex items-center gap-1 underline">
              <PhoneCall className="w-3 h-3" /> 108 (Ambulance)
            </a>
          </div>
        </div>

        {mode === 'text' ? (
          <>
            {/* Grounding Mode & Quick Prompts */}
            <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-slate-500 dark:text-slate-400">Live Grounding:</span>
                <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
                  {(['auto', 'maps', 'search'] as GroundingMode[]).map((gm) => (
                    <button
                      key={gm}
                      type="button"
                      onClick={() => setGroundingMode(gm)}
                      className={`px-2 py-1 rounded-md font-semibold capitalize ${
                        groundingMode === gm
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {gm === 'search' ? 'Google Search' : gm === 'maps' ? 'Google Maps' : 'Auto'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-0.5">
                {[
                  'Latest Assam flood & IMD alert',
                  'Nearby hospitals & open shelters',
                  'Flood safety checklist',
                  'How does SOS work?',
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    className="min-h-[34px] px-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'ml-auto bg-sky-600 text-white whitespace-pre-wrap'
                      : 'mr-auto bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 space-y-2'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.text}</div>

                  {m.groundingLinks && m.groundingLinks.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400 flex items-center gap-1">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        <span>Google Maps Verified Locations</span>
                      </p>
                      <div className="space-y-1">
                        {m.groundingLinks.map((link) => (
                          <a
                            key={link.uri}
                            href={link.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-xl bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs hover:border-sky-500 transition-colors"
                          >
                            <span className="font-semibold text-sky-600 dark:text-sky-400 inline-flex items-center gap-1">
                              <span>{link.title}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                            </span>
                            {link.snippet && (
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                                {link.snippet}
                              </p>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {m.webSources && m.webSources.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <Globe className="w-3 h-3" aria-hidden="true" />
                        <span>Google Search Web Sources</span>
                      </p>
                      <div className="space-y-1">
                        {m.webSources.map((src) => (
                          <a
                            key={src.uri}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-xl bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs hover:border-emerald-500 transition-colors"
                          >
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                              <span>{src.title}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="mr-auto rounded-2xl px-4 py-2.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-500">
                  Checking live shelters, Google Maps, Google Search &amp; safety protocol...
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(input);
              }}
              className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask safety guidance, hospitals, or shelter status..."
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 text-sm"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="min-h-[44px] min-w-[44px] rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white flex items-center justify-center"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          /* Live Voice Mode (Gemini 3.8 Live Bidirectional Audio) */
          <div className="flex-1 flex flex-col justify-between p-4 overflow-hidden">
            <div className="space-y-3 flex-1 flex flex-col min-h-0">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-center space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400">
                  Live Two-Way Voice Rescue Assistant
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Speak naturally in English, Assamese, or Hindi for hands-free flood, landslide, or shelter guidance. You can interrupt at any time.
                </p>
                <div className="pt-2 flex justify-center">
                  {voiceStatus === 'live' || voiceStatus === 'connecting' ? (
                    <button
                      type="button"
                      onClick={stopVoiceSession}
                      className="min-h-[52px] px-6 rounded-2xl bg-red-600 hover:bg-red-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-lg"
                    >
                      <MicOff className="w-5 h-5" aria-hidden="true" />
                      <span>{voiceStatus === 'connecting' ? 'Connecting...' : 'End Voice Call'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startVoiceSession}
                      className="min-h-[52px] px-6 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold inline-flex items-center gap-2 shadow-lg"
                    >
                      <Mic className="w-5 h-5" aria-hidden="true" />
                      <span>Start Live Voice</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Status: {voiceStatus.toUpperCase()} · 16kHz Mic / 24kHz Audio
                </p>
              </div>

              {voiceError && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
                  {voiceError}
                </div>
              )}

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {voiceTurns.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 dark:text-slate-400 pt-6">
                    Live speech captions will appear here during your voice session.
                  </p>
                ) : (
                  voiceTurns.map((turn) => (
                    <div
                      key={turn.id}
                      className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                        turn.speaker === 'you'
                          ? 'ml-auto bg-sky-600 text-white'
                          : 'mr-auto bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      <span className="block text-[10px] font-bold uppercase opacity-75 mb-0.5">
                        {turn.speaker === 'you' ? 'You' : 'Rescue Coordinator'}
                      </span>
                      {turn.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
