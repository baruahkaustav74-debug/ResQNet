import { GoogleGenAI } from '@google/genai';
import { getDistrictSeed } from '../shared/assamGeo.ts';
import type {
  GroundingMode,
  LanguageCode,
  LiveAssamBrief,
  MapGroundingLink,
  WebGroundingLink,
} from '../shared/types.ts';
import { db, mapAlertRow, mapShelterRow } from './db.ts';

let geminiClient: GoogleGenAI | null = null;
let cachedLiveBrief: { data: LiveAssamBrief; expiresAt: number } | null = null;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

export interface ChatHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

function shouldUseMapsGrounding(message: string): boolean {
  return /\b(near|nearby|hospital|clinic|pharmacy|shelter|camp|relief|route|directions|road|highway|bridge|ferry|police|fire station|medical|where|closest|nearest|distance|km|guwahati|jorhat|dibrugarh|silchar|tezpur|nagaon|barpeta|dhubri|majuli|cachar)\b/i.test(
    message
  );
}

function shouldUseSearchGrounding(message: string): boolean {
  return /\b(weather|forecast|rain|monsoon|imd|asdma|cwc|brahmaputra|barak|river level|danger level|bulletin|news|latest|today|update|advisory|guidelines|ndma|sdrf|ndrf|alert|warning|evacuation)\b/i.test(
    message
  );
}

interface RawGroundingChunk {
  maps?: {
    uri?: string;
    title?: string;
    placeAnswerSources?: {
      reviewSnippets?: Array<{ content?: string }>;
    };
  };
  web?: {
    uri?: string;
    title?: string;
  };
}

function extractGroundingMetadata(chunks: RawGroundingChunk[] | undefined): {
  groundingLinks: MapGroundingLink[];
  webSources: WebGroundingLink[];
} {
  const groundingLinks: MapGroundingLink[] = [];
  const webSources: WebGroundingLink[] = [];
  const seenMapUris = new Set<string>();
  const seenWebUris = new Set<string>();

  if (!Array.isArray(chunks)) {
    return { groundingLinks, webSources };
  }

  for (const chunk of chunks) {
    const mapUri = chunk.maps?.uri?.trim();
    const mapTitle = chunk.maps?.title?.trim();
    if (mapUri && mapTitle && !seenMapUris.has(mapUri)) {
      seenMapUris.add(mapUri);
      const snippet = chunk.maps?.placeAnswerSources?.reviewSnippets?.[0]?.content?.trim();
      groundingLinks.push({ title: mapTitle, uri: mapUri, snippet });
    }

    const webUri = chunk.web?.uri?.trim();
    const webTitle = chunk.web?.title?.trim();
    if (webUri && !seenWebUris.has(webUri)) {
      seenWebUris.add(webUri);
      webSources.push({
        title: webTitle || webUri,
        uri: webUri,
      });
    }
  }

  return { groundingLinks, webSources };
}

export async function askRescueAssistant(params: {
  message: string;
  history?: ChatHistoryTurn[];
  language?: LanguageCode;
  userDistrict?: string | null;
  userLocation?: { lat: number; lng: number } | null;
  groundingMode?: GroundingMode;
}): Promise<{
  reply: string;
  modelUsed: string;
  liveSheltersCount: number;
  groundingLinks: MapGroundingLink[];
  webSources: WebGroundingLink[];
  groundingUsed: 'maps' | 'search' | 'none';
}> {
  const now = Date.now();
  const shelters = (
    db.prepare(`SELECT * FROM shelters ORDER BY updated_at DESC LIMIT 20`).all() as Record<string, unknown>[]
  ).map(mapShelterRow);

  const activeAlerts = (
    db.prepare(`SELECT * FROM alerts WHERE expires_at > ? ORDER BY created_at DESC LIMIT 10`).all(now) as Record<
      string,
      unknown
    >[]
  ).map(mapAlertRow);

  const shelterContext = shelters
    .map(
      (s) =>
        `- ${s.name} (${s.district}) | Status: ${s.status.toUpperCase()} | Available Beds: ${Math.max(0, s.capacity - s.occupied)}/${s.capacity} | Facilities: ${Object.entries(
          s.facilities
        )
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(', ') || 'basic'} | Contact: ${s.contactPhone}`
    )
    .join('\n');

  const alertContext =
    activeAlerts.length > 0
      ? activeAlerts
          .map((a) => `- [${a.severity}] ${a.title} (Districts: ${a.districts.join(', ')}): ${a.message}`)
          .join('\n')
      : 'No active state alerts right now.';

  const langLabel =
    params.language === 'as'
      ? 'Assamese (অসমীয়া, Unicode script)'
      : params.language === 'hi'
        ? 'Hindi (हिन्दी, Devanagari script)'
        : 'English';

  const districtSeed = getDistrictSeed(params.userDistrict || 'Kamrup Metropolitan');
  const retrievalLatLng = params.userLocation
    ? { latitude: params.userLocation.lat, longitude: params.userLocation.lng }
    : { latitude: districtSeed?.lat ?? 26.1445, longitude: districtSeed?.lng ?? 91.7362 };

  const systemInstruction = `You are the DisasterGuard Assam Rescue Assistant, supporting citizens, field volunteers, and coordinators during floods, landslides, storms, earthquakes, fires, and lightning in Assam, India.

RULES:
1. Respond concisely and clearly in ${langLabel}. Use short numbered steps for action checklists.
2. NEVER invent shelter availability, addresses, or phone numbers. Only cite shelters from the LIVE SHELTER DATA below, real places returned by the Google Maps grounding tool, or verified web information returned by Google Search grounding.
3. For any life-threatening emergency, ALWAYS highlight official Assam/India emergency numbers: 112 (National Emergency), 1070 (ASDMA State Control Room), 1077 (District Emergency Operation Centre), 108 (Ambulance).
4. Explain DisasterGuard app features clearly when asked (SOS button with GPS & 5-minute auto-escalation, Offline Action Log & Sync, Offline SMS SOS link, Google Maps Assam 35-district view & Nearest Shelter route, Shelters live occupancy, Volunteer Reports with offline sync, Early Alerts, Live Voice).
5. Always include a short 1-line safety disclaimer noting this is automated guidance and cannot replace on-ground rescue authorities.

USER DISTRICT CONTEXT: ${params.userDistrict || 'Kamrup Metropolitan (Assam)'}
USER COORDINATES CONTEXT: ${retrievalLatLng.latitude.toFixed(4)}, ${retrievalLatLng.longitude.toFixed(4)}

LIVE SHELTER DATA:
${shelterContext || 'No shelters currently registered.'}

ACTIVE EARLY ALERTS:
${alertContext}`;

  const ai = getGeminiClient();
  if (!ai) {
    const openShelters = shelters.filter((s) => s.status === 'open').slice(0, 3);
    const shelterSummary =
      openShelters.length > 0
        ? openShelters
            .map((s) => `• ${s.name} (${s.district}) — ${Math.max(0, s.capacity - s.occupied)} spots open`)
            .join('\n')
        : 'Check the Shelters tab for live camp availability.';

    return {
      reply: `Emergency Helplines: 112 (National ERSS) · 1070 (ASDMA State Control) · 1077 (District DEOC) · 108 (Ambulance).\n\nLive Gemini AI responses require GEMINI_API_KEY configured on the server. Meanwhile, here is live open shelter data from the command center:\n${shelterSummary}\n\nSafety guidance: Move to high ground during floods, avoid landslide-prone slopes and downed power lines, and tap the SOS tab to alert your district volunteers immediately.\n\nDisclaimer: Automated guidance only; follow instructions from ASDMA, SDRF, and local authorities.`,
      modelUsed: 'offline-fallback',
      liveSheltersCount: shelters.length,
      groundingLinks: [],
      webSources: [],
      groundingUsed: 'none',
    };
  }

  const historyParts = (params.history || []).slice(-8).map((turn) => ({
    role: turn.role === 'model' ? 'model' : 'user',
    parts: [{ text: turn.text }],
  }));

  // Google Maps and Google Search tools cannot be enabled in the same generateContent request
  const mode: GroundingMode = params.groundingMode || 'auto';
  let activeTool: 'maps' | 'search' | 'none' = 'none';
  if (mode === 'maps') {
    activeTool = 'maps';
  } else if (mode === 'search') {
    activeTool = 'search';
  } else {
    if (shouldUseMapsGrounding(params.message)) {
      activeTool = 'maps';
    } else if (shouldUseSearchGrounding(params.message)) {
      activeTool = 'search';
    } else if (params.userLocation) {
      activeTool = 'maps';
    } else {
      activeTool = 'search';
    }
  }

  try {
    const toolConfigBlock =
      activeTool === 'maps'
        ? {
            tools: [{ googleMaps: {} }],
            toolConfig: {
              retrievalConfig: {
                latLng: retrievalLatLng,
              },
            },
          }
        : activeTool === 'search'
          ? {
              tools: [{ googleSearch: {} }],
            }
          : {};

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        ...historyParts,
        {
          role: 'user',
          parts: [{ text: params.message }],
        },
      ],
      config: {
        systemInstruction,
        ...toolConfigBlock,
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as RawGroundingChunk[] | undefined;
    const { groundingLinks, webSources } = extractGroundingMetadata(chunks);

    const replyText =
      response.text?.trim() ||
      'Unable to generate a response right now. In an emergency, please dial 112 or 1070 immediately.';

    return {
      reply: replyText,
      modelUsed: 'gemini-4-hydrogen',
      liveSheltersCount: shelters.length,
      groundingLinks,
      webSources,
      groundingUsed: activeTool,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const openShelters = shelters.filter((s) => s.status === 'open').slice(0, 4);
    const shelterSummary =
      openShelters.length > 0
        ? openShelters
            .map(
              (s) =>
                `• ${s.name} (${s.district}) — ${Math.max(0, s.capacity - s.occupied)}/${s.capacity} beds open · Tel: ${s.contactPhone}`
            )
            .join('\n')
        : 'Check the Shelters tab for live camp availability.';

    const isQuota = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
    return {
      reply: `Emergency Helplines: 112 (National ERSS) · 1070 (ASDMA State Control) · 1077 (District DEOC) · 108 (Ambulance).\n\n${
        isQuota
          ? 'AI assistant rate limit reached momentarily. Here is live open shelter data directly from the DisasterGuard command database:'
          : 'Live AI assistant temporarily unavailable. Here is live open shelter data directly from the command database:'
      }\n${shelterSummary}\n\nSafety Action Steps:\n1. Move to higher ground immediately if water is rising.\n2. Avoid flooded roads, landslides, and downed power lines.\n3. Use the SOS tab (or Offline SMS fallback) to alert district volunteers.\n\nDisclaimer: Automated guidance only; follow instructions from ASDMA, SDRF, and local authorities.`,
      modelUsed: isQuota ? 'quota-fallback' : 'error-fallback',
      liveSheltersCount: shelters.length,
      groundingLinks: [
        {
          title: `Search Hospitals Near ${params.userDistrict || 'Guwahati'} on Google Maps`,
          uri: `https://www.google.com/maps/search/hospital/@${retrievalLatLng.latitude},${retrievalLatLng.longitude},13z`,
        },
      ],
      webSources: [
        {
          title: 'Assam State Disaster Management Authority (ASDMA)',
          uri: 'https://asdma.assam.gov.in/',
        },
        {
          title: 'IMD Regional Meteorological Centre Guwahati',
          uri: 'https://mausam.imd.gov.in/guwahati/',
        },
      ],
      groundingUsed: 'none',
    };
  }
}

export async function getAssamLiveSearchBrief(forceRefresh = false): Promise<LiveAssamBrief> {
  const now = Date.now();
  if (!forceRefresh && cachedLiveBrief && cachedLiveBrief.expiresAt > now) {
    return cachedLiveBrief.data;
  }

  const ai = getGeminiClient();
  if (!ai) {
    return buildFallbackBrief(now, 'offline-fallback');
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents:
        'Provide a concise, factual 4-bullet operational briefing on the latest weather alerts, monsoon rainfall warnings, Brahmaputra/Barak flood situation, and ASDMA or IMD advisories for Assam, India. Focus on districts affected and immediate citizen precautions.',
      config: {
        systemInstruction:
          'You are a factual disaster intelligence analyst for Assam, India. Summarize only verifiable current advisories from official weather and disaster management sources in 4 short, clear bullet points. Do not fabricate river gauges or dates.',
        tools: [{ googleSearch: {} }],
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as RawGroundingChunk[] | undefined;
    const { webSources } = extractGroundingMetadata(chunks);

    const brief: LiveAssamBrief = {
      summary:
        response.text?.trim() ||
        'Live web briefing returned no summary. Check ASDMA (1070) and IMD Guwahati portals for official warnings.',
      webSources:
        webSources.length > 0
          ? webSources.slice(0, 6)
          : [
              { title: 'ASDMA Official Portal', uri: 'https://asdma.assam.gov.in/' },
              { title: 'IMD Regional Centre Guwahati', uri: 'https://mausam.imd.gov.in/guwahati/' },
            ],
      modelUsed: 'gemini-4-hydrogen',
      updatedAt: now,
    };

    cachedLiveBrief = { data: brief, expiresAt: now + 15 * 60 * 1000 };
    return brief;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') ? 'quota-fallback' : 'error-fallback';
    return buildFallbackBrief(now, reason);
  }
}

function buildFallbackBrief(now: number, modelUsed: string): LiveAssamBrief {
  const activeAlerts = (
    db.prepare(`SELECT * FROM alerts WHERE expires_at > ? ORDER BY created_at DESC LIMIT 4`).all(now) as Record<
      string,
      unknown
    >[]
  ).map(mapAlertRow);

  const summary =
    activeAlerts.length > 0
      ? activeAlerts
          .map((a) => `• [${a.severity}] ${a.title} (${a.districts.join(', ')}) — ${a.message}`)
          .join('\n')
      : '• Monitor Brahmaputra and Barak basin bulletins via ASDMA (1070) and IMD Guwahati.\n• Keep emergency go-bags, dry rations, and charged power banks ready in low-lying districts.';

  return {
    summary,
    webSources: [
      { title: 'Assam State Disaster Management Authority (ASDMA)', uri: 'https://asdma.assam.gov.in/' },
      { title: 'IMD Regional Meteorological Centre Guwahati', uri: 'https://mausam.imd.gov.in/guwahati/' },
      { title: 'Central Water Commission Flood Forecast', uri: 'https://ffs.india-water.gov.in/' },
    ],
    modelUsed,
    updatedAt: now,
  };
}
