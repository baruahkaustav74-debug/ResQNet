import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { GoogleGenAI, type LiveServerMessage, Modality } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import type { LanguageCode } from '../shared/types.ts';
import { db, mapAlertRow, mapShelterRow } from './db.ts';

function createLiveAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildVoiceSystemInstruction(language: LanguageCode, district: string | null): string {
  const now = Date.now();
  const shelters = (
    db.prepare(`SELECT * FROM shelters WHERE status = 'open' ORDER BY updated_at DESC LIMIT 12`).all() as Record<
      string,
      unknown
    >[]
  ).map(mapShelterRow);

  const activeAlerts = (
    db.prepare(`SELECT * FROM alerts WHERE expires_at > ? ORDER BY created_at DESC LIMIT 6`).all(now) as Record<
      string,
      unknown
    >[]
  ).map(mapAlertRow);

  const shelterSummary = shelters
    .map(
      (s) =>
        `${s.name} in ${s.district} (${Math.max(0, s.capacity - s.occupied)} beds open, contact ${s.contactPhone})`
    )
    .join('; ');

  const alertSummary = activeAlerts
    .map((a) => `[${a.severity}] ${a.title} for ${a.districts.join(', ')}`)
    .join('; ');

  const langLabel =
    language === 'as' ? 'Assamese' : language === 'hi' ? 'Hindi' : 'English';

  return `You are the DisasterGuard Assam Live Voice Rescue Coordinator speaking directly with someone who may be in distress or preparing for disasters in Assam, India.
Speak calmly, clearly, and briefly in ${langLabel} (under 3 concise spoken sentences per turn unless step-by-step CPR/safety guidance is requested).
For any life-threatening situation, immediately tell the caller to dial 112 (National Emergency), 1070 (ASDMA State Control), 1077 (District DEOC), or 108 (Ambulance).
Never invent shelter details; only reference live shelters below.
User district context: ${district || 'Assam'}.
Open shelters: ${shelterSummary || 'Check the Shelters tab for camp availability.'}
Active alerts: ${alertSummary || 'No active early warnings.'}
Remind callers briefly that automated voice guidance supports—not replaces—official emergency dispatchers.`;
}

class LiveVoiceHub {
  private wss: WebSocketServer | null = null;

  private ensureWss(): WebSocketServer {
    if (this.wss) return this.wss;
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', async (clientWs: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '/ws/live', 'http://localhost');
      const langParam = url.searchParams.get('lang');
      const language: LanguageCode =
        langParam === 'as' || langParam === 'hi' ? langParam : 'en';
      const district = url.searchParams.get('district') || null;

      const ai = createLiveAiClient();
      if (!ai) {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              error: 'Live Voice requires GEMINI_API_KEY configured on the server.',
            })
          );
          clientWs.close();
        }
        return;
      }

      let closedByClient = false;
      let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

      try {
        session = await ai.live.connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: buildVoiceSystemInstruction(language, district),
          },
          callbacks: {
            onopen: () => {
              if (!closedByClient && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ ready: true }));
              }
            },
            onmessage: (message: LiveServerMessage) => {
              if (clientWs.readyState !== WebSocket.OPEN) return;
              const content = message.serverContent;

              if (content?.inputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({ inputTranscript: content.inputTranscription.text })
                );
              }
              if (content?.outputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({ outputTranscript: content.outputTranscription.text })
                );
              }
              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                }
              }
              if (content?.interrupted) {
                clientWs.send(JSON.stringify({ interrupted: true }));
              }
              if (content?.turnComplete) {
                clientWs.send(JSON.stringify({ turnComplete: true }));
              }
            },
            onerror: (err: unknown) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(
                  JSON.stringify({
                    error:
                      err instanceof Error
                        ? err.message
                        : 'Gemini Live voice session error.',
                  })
                );
              }
            },
            onclose: () => {
              if (!closedByClient && clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            },
          },
        });
      } catch (err) {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              error:
                err instanceof Error
                  ? err.message
                  : 'Unable to start live voice session.',
            })
          );
          clientWs.close();
        }
        return;
      }

      if (closedByClient) {
        session.close();
        return;
      }

      clientWs.on('message', (raw) => {
        if (!session) return;
        try {
          const msg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
          if (typeof msg.audio === 'string' && msg.audio.length > 0) {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
            });
          } else if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
            session.sendRealtimeInput({ text: msg.text.trim() });
          }
        } catch {
          // ignore malformed audio frame
        }
      });

      const cleanup = () => {
        closedByClient = true;
        if (session) {
          try {
            session.close();
          } catch {
            // ignore close error
          }
          session = null;
        }
      };

      clientWs.on('close', cleanup);
      clientWs.on('error', cleanup);
    });

    return this.wss;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const wss = this.ensureWss();
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
}

export const liveVoiceHub = new LiveVoiceHub();
