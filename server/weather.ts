import type { Severity, WeatherAdvisory } from '../shared/types.ts';

const ASSAM_STATIONS = [
  { station: 'Guwahati / Brahmaputra Central', district: 'Kamrup Metropolitan', lat: 26.1445, lng: 91.7362 },
  { station: 'Dibrugarh / Upper Brahmaputra', district: 'Dibrugarh', lat: 27.4728, lng: 94.912 },
  { station: 'Jorhat / Majuli Basin', district: 'Jorhat', lat: 26.7509, lng: 94.2037 },
  { station: 'Silchar / Barak Valley', district: 'Cachar', lat: 24.8333, lng: 92.7789 },
  { station: 'Dhubri / Lower Brahmaputra', district: 'Dhubri', lat: 26.0207, lng: 89.9743 },
  { station: 'Tezpur / North Bank', district: 'Sonitpur', lat: 26.6739, lng: 92.8577 },
];

let cachedWeather: { data: WeatherAdvisory[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

function computeAdvisoryLevel(rain24h: number, windKmh: number, precipNow: number): {
  level: Severity;
  summary: string;
} {
  if (rain24h >= 115 || precipNow >= 25 || windKmh >= 65) {
    return {
      level: 'CRITICAL',
      summary: 'Heavy rainfall / squall alert — high flood & landslide potential.',
    };
  }
  if (rain24h >= 65 || precipNow >= 10 || windKmh >= 45) {
    return {
      level: 'HIGH',
      summary: 'Elevated monsoon rainfall — monitor river embankments & drainage.',
    };
  }
  if (rain24h >= 25 || precipNow >= 2 || windKmh >= 30) {
    return {
      level: 'MODERATE',
      summary: 'Moderate showers across basin; localized waterlogging possible.',
    };
  }
  return {
    level: 'LOW',
    summary: 'Stable weather conditions; routine river level monitoring.',
  };
}

export async function getAssamWeatherAdvisories(): Promise<WeatherAdvisory[]> {
  if (cachedWeather && Date.now() - cachedWeather.fetchedAt < CACHE_TTL_MS) {
    return cachedWeather.data;
  }

  try {
    const lats = ASSAM_STATIONS.map((s) => s.lat).join(',');
    const lngs = ASSAM_STATIONS.map((s) => s.lng).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=temperature_2m,precipitation,wind_speed_10m&daily=precipitation_sum&timezone=Asia%2FKolkata&forecast_days=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }

    const raw = (await res.json()) as unknown;
    const list = Array.isArray(raw) ? raw : [raw];
    const now = Date.now();

    const advisories: WeatherAdvisory[] = ASSAM_STATIONS.map((st, idx) => {
      const entry = (list[idx] || {}) as {
        current?: { temperature_2m?: number; precipitation?: number; wind_speed_10m?: number };
        daily?: { precipitation_sum?: number[] };
      };
      const temp = Number(entry.current?.temperature_2m ?? 26);
      const precip = Number(entry.current?.precipitation ?? 0);
      const wind = Number(entry.current?.wind_speed_10m ?? 8);
      const rain24h = Number(entry.daily?.precipitation_sum?.[0] ?? precip);
      const { level, summary } = computeAdvisoryLevel(rain24h, wind, precip);
      return {
        station: st.station,
        district: st.district,
        lat: st.lat,
        lng: st.lng,
        temperatureC: Math.round(temp * 10) / 10,
        precipitationMm: Math.round(precip * 10) / 10,
        rain24hMm: Math.round(rain24h * 10) / 10,
        windKmh: Math.round(wind * 10) / 10,
        advisoryLevel: level,
        summary,
        updatedAt: now,
      };
    });

    cachedWeather = { data: advisories, fetchedAt: now };
    return advisories;
  } catch {
    if (cachedWeather) return cachedWeather.data;
    const now = Date.now();
    return ASSAM_STATIONS.map((st) => ({
      station: st.station,
      district: st.district,
      lat: st.lat,
      lng: st.lng,
      temperatureC: 27,
      precipitationMm: 0,
      rain24hMm: 12,
      windKmh: 10,
      advisoryLevel: 'LOW' as Severity,
      summary: 'Weather feed temporarily unavailable; rely on official ASDMA alerts.',
      updatedAt: now,
    }));
  }
}
