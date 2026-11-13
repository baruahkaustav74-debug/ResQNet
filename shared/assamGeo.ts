export interface DistrictSeed {
  name: string;
  code: string;
  lat: number;
  lng: number;
  region: 'Lower Assam' | 'Central Assam' | 'Upper Assam' | 'North Bank' | 'Barak Valley' | 'Hill Districts';
}

export const ASSAM_DISTRICTS: DistrictSeed[] = [
  { name: 'Dhubri', code: 'AS-DB', lat: 26.0207, lng: 89.9743, region: 'Lower Assam' },
  { name: 'South Salmara-Mankachar', code: 'AS-SSM', lat: 25.7366, lng: 89.8988, region: 'Lower Assam' },
  { name: 'Kokrajhar', code: 'AS-KJ', lat: 26.4014, lng: 90.2667, region: 'Lower Assam' },
  { name: 'Goalpara', code: 'AS-GP', lat: 26.1641, lng: 90.6252, region: 'Lower Assam' },
  { name: 'Bongaigaon', code: 'AS-BO', lat: 26.4783, lng: 90.5582, region: 'Lower Assam' },
  { name: 'Chirang', code: 'AS-CH', lat: 26.6471, lng: 90.6267, region: 'Lower Assam' },
  { name: 'Barpeta', code: 'AS-BP', lat: 26.3229, lng: 91.0063, region: 'Lower Assam' },
  { name: 'Bajali', code: 'AS-BJ', lat: 26.5269, lng: 91.1965, region: 'Lower Assam' },
  { name: 'Baksa', code: 'AS-BK', lat: 26.6935, lng: 91.3512, region: 'Lower Assam' },
  { name: 'Nalbari', code: 'AS-NB', lat: 26.4449, lng: 91.4414, region: 'Lower Assam' },
  { name: 'Tamulpur', code: 'AS-TP', lat: 26.6414, lng: 91.5724, region: 'Lower Assam' },
  { name: 'Kamrup', code: 'AS-KR', lat: 26.3161, lng: 91.5984, region: 'Lower Assam' },
  { name: 'Kamrup Metropolitan', code: 'AS-KM', lat: 26.1445, lng: 91.7362, region: 'Lower Assam' },
  { name: 'Udalguri', code: 'AS-UD', lat: 26.7453, lng: 92.0962, region: 'North Bank' },
  { name: 'Darrang', code: 'AS-DR', lat: 26.4522, lng: 92.0315, region: 'North Bank' },
  { name: 'Morigaon', code: 'AS-MR', lat: 26.2528, lng: 92.3422, region: 'Central Assam' },
  { name: 'Nagaon', code: 'AS-NG', lat: 26.348, lng: 92.6838, region: 'Central Assam' },
  { name: 'Hojai', code: 'AS-HJ', lat: 26.0049, lng: 92.8535, region: 'Central Assam' },
  { name: 'Sonitpur', code: 'AS-ST', lat: 26.6739, lng: 92.8577, region: 'North Bank' },
  { name: 'Biswanath', code: 'AS-BN', lat: 26.7277, lng: 93.1476, region: 'North Bank' },
  { name: 'West Karbi Anglong', code: 'AS-WKA', lat: 25.9225, lng: 92.4876, region: 'Hill Districts' },
  { name: 'Karbi Anglong', code: 'AS-KA', lat: 26.1835, lng: 93.4586, region: 'Hill Districts' },
  { name: 'Golaghat', code: 'AS-GG', lat: 26.5239, lng: 93.9623, region: 'Upper Assam' },
  { name: 'Jorhat', code: 'AS-JT', lat: 26.7509, lng: 94.2037, region: 'Upper Assam' },
  { name: 'Majuli', code: 'AS-MJ', lat: 26.9547, lng: 94.1672, region: 'Upper Assam' },
  { name: 'Lakhimpur', code: 'AS-LP', lat: 27.2361, lng: 94.1036, region: 'North Bank' },
  { name: 'Dhemaji', code: 'AS-DM', lat: 27.4793, lng: 94.5579, region: 'North Bank' },
  { name: 'Sivasagar', code: 'AS-SV', lat: 26.9826, lng: 94.6425, region: 'Upper Assam' },
  { name: 'Charaideo', code: 'AS-CD', lat: 26.9278, lng: 94.9612, region: 'Upper Assam' },
  { name: 'Dibrugarh', code: 'AS-DBR', lat: 27.4728, lng: 94.912, region: 'Upper Assam' },
  { name: 'Tinsukia', code: 'AS-TS', lat: 27.4922, lng: 95.3468, region: 'Upper Assam' },
  { name: 'Dima Hasao', code: 'AS-DH', lat: 25.2981, lng: 93.0211, region: 'Hill Districts' },
  { name: 'Cachar', code: 'AS-CC', lat: 24.8333, lng: 92.7789, region: 'Barak Valley' },
  { name: 'Hailakandi', code: 'AS-HK', lat: 24.6847, lng: 92.5646, region: 'Barak Valley' },
  { name: 'Karimganj', code: 'AS-KG', lat: 24.8693, lng: 92.3554, region: 'Barak Valley' },
];

export const DISTRICT_NAMES: string[] = ASSAM_DISTRICTS.map((d) => d.name);

// Assam state outer boundary polygon [lng, lat] counter-clockwise
const ASSAM_OUTER_BOUNDARY: [number, number][] = [
  [89.68, 25.95],
  [89.76, 25.48],
  [89.98, 25.44],
  [90.15, 25.85],
  [90.45, 25.94],
  [90.85, 25.98],
  [91.32, 26.02],
  [91.85, 26.05],
  [92.18, 25.85],
  [92.42, 25.55],
  [92.62, 25.35],
  [92.22, 25.02],
  [92.16, 24.62],
  [92.38, 24.16],
  [92.66, 24.22],
  [92.95, 24.55],
  [93.24, 24.92],
  [93.45, 25.32],
  [93.75, 25.82],
  [93.98, 26.18],
  [94.38, 26.45],
  [94.82, 26.72],
  [95.28, 26.98],
  [95.68, 27.32],
  [96.02, 27.62],
  [95.88, 27.94],
  [95.25, 27.85],
  [94.68, 27.68],
  [94.15, 27.55],
  [93.62, 27.18],
  [93.02, 26.96],
  [92.45, 26.92],
  [91.95, 26.88],
  [91.38, 26.86],
  [90.82, 26.85],
  [90.22, 26.84],
  [89.82, 26.68],
  [89.68, 26.32],
  [89.68, 25.95],
];

// Sutherland-Hodgman polygon clipping against a half-plane a*x + b*y <= c
function clipPolygonHalfPlane(
  poly: [number, number][],
  a: number,
  b: number,
  c: number
): [number, number][] {
  if (poly.length === 0) return [];
  const out: [number, number][] = [];
  const inside = (p: [number, number]) => a * p[0] + b * p[1] <= c + 1e-10;
  const intersect = (p1: [number, number], p2: [number, number]): [number, number] => {
    const d1 = a * p1[0] + b * p1[1] - c;
    const d2 = a * p2[0] + b * p2[1] - c;
    const denom = d1 - d2;
    if (Math.abs(denom) < 1e-12) return p1;
    const t = d1 / denom;
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  };

  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

export interface AssamDistrictFeature {
  type: 'Feature';
  properties: {
    name: string;
    code: string;
    region: string;
    centroidLat: number;
    centroidLng: number;
  };
  geometry: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
}

export interface AssamGeoJson {
  type: 'FeatureCollection';
  features: AssamDistrictFeature[];
}

function buildAssamGeoJson(): AssamGeoJson {
  const baseRing = ASSAM_OUTER_BOUNDARY.slice(0, -1);
  const features: AssamDistrictFeature[] = [];

  for (const target of ASSAM_DISTRICTS) {
    let cell: [number, number][] = baseRing.map(([x, y]) => [x, y]);
    // Weight longitude slightly by cos(26deg) for metric Voronoi accuracy
    const cosLat = Math.cos((26 * Math.PI) / 180);
    const tx = target.lng * cosLat;
    const ty = target.lat;

    for (const other of ASSAM_DISTRICTS) {
      if (other.name === target.name) continue;
      const ox = other.lng * cosLat;
      const oy = other.lat;
      // (p - t)^2 <= (p - o)^2  =>  2*(ox - tx)*cosLat*lng + 2*(oy - ty)*lat <= ox^2 + oy^2 - tx^2 - ty^2
      const a = 2 * (ox - tx) * cosLat;
      const b = 2 * (oy - ty);
      const c = ox * ox + oy * oy - tx * tx - ty * ty;
      cell = clipPolygonHalfPlane(cell, a, b, c);
      if (cell.length < 3) break;
    }

    if (cell.length >= 3) {
      const closed = [...cell, cell[0]];
      features.push({
        type: 'Feature',
        properties: {
          name: target.name,
          code: target.code,
          region: target.region,
          centroidLat: target.lat,
          centroidLng: target.lng,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [closed],
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

export const ASSAM_GEOJSON: AssamGeoJson = buildAssamGeoJson();

export function pointInPolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Detects Assam district via point-in-polygon against the 35-district GeoJSON.
 * Falls back to the nearest district centroid if the coordinate lies just outside border jitter.
 */
export function detectDistrictByPoint(lat: number, lng: number): { district: string; insideAssam: boolean } {
  for (const feature of ASSAM_GEOJSON.features) {
    const ring = feature.geometry.coordinates[0];
    if (pointInPolygon(lat, lng, ring)) {
      return { district: feature.properties.name, insideAssam: true };
    }
  }

  // Nearest district fallback
  let best = ASSAM_DISTRICTS[0];
  let bestDist = Infinity;
  for (const d of ASSAM_DISTRICTS) {
    const dist = haversineKm(lat, lng, d.lat, d.lng);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return { district: best.name, insideAssam: bestDist <= 120 };
}

export function getNearbyDistricts(districtName: string, count = 4): string[] {
  const origin = ASSAM_DISTRICTS.find((d) => d.name === districtName);
  if (!origin) return [];
  return ASSAM_DISTRICTS.filter((d) => d.name !== districtName)
    .map((d) => ({ name: d.name, dist: haversineKm(origin.lat, origin.lng, d.lat, d.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map((x) => x.name);
}

export function getDistrictSeed(districtName: string): DistrictSeed | undefined {
  return ASSAM_DISTRICTS.find((d) => d.name === districtName);
}
