import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MarkerClusterer, type Marker as ClusterMarker } from '@googlemaps/markerclusterer';
import { Filter, Layers, LocateFixed, MapPin, Navigation } from 'lucide-react';
import {
  ASSAM_DISTRICTS,
  ASSAM_GEOJSON,
  getDistrictSeed,
  haversineKm,
} from '../../../shared/assamGeo';
import {
  SEVERITY_RANK,
  type DisasterReport,
  type DisasterType,
  type LanguageCode,
  type Severity,
  type Shelter,
} from '../../../shared/types';
import { DISASTER_TYPE_LABELS, TRANSLATIONS } from '../../i18n/translations';
import { SeverityIndicator } from '../../components/SeverityIndicator';
import { useAppData } from '../auth/AuthContext';

type TileMode = 'roadmap' | 'satellite' | 'terrain';
type TimeRange = '24h' | '72h' | '7d' | 'all';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const ASSAM_CENTER = { lat: 26.2006, lng: 92.9376 };

const SEVERITY_FILL: Record<Severity, string> = {
  CRITICAL: '#EF4444',
  HIGH: '#F97316',
  MODERATE: '#EAB308',
  LOW: '#10B981',
};

type SelectedItem =
  | { kind: 'report'; data: DisasterReport; key: string }
  | { kind: 'shelter'; data: Shelter; key: string };

const DistrictGeoJsonLayer: React.FC<{
  districtSeverity: Record<string, Severity>;
  selectedDistrict: string;
  onSelectDistrict: (district: string) => void;
}> = ({ districtSeverity, selectedDistrict, onSelectDistrict }) => {
  const map = useMap();
  const dataLoadedRef = useRef(false);

  useEffect(() => {
    if (!map) return;
    if (!dataLoadedRef.current) {
      map.data.addGeoJson(ASSAM_GEOJSON as unknown as object);
      dataLoadedRef.current = true;
    }

    map.data.setStyle((feature) => {
      const name = String(feature.getProperty('name') || '');
      const sev = districtSeverity[name];
      const isSelected = name === selectedDistrict;
      return {
        strokeColor: isSelected ? '#38BDF8' : '#94A3B8',
        strokeWeight: isSelected ? 2.5 : 1,
        fillColor: sev ? SEVERITY_FILL[sev] : '#334155',
        fillOpacity: sev ? (isSelected ? 0.42 : 0.28) : isSelected ? 0.22 : 0.1,
        clickable: true,
      };
    });

    const listener = map.data.addListener('click', (event: google.maps.Data.MouseEvent) => {
      const name = String(event.feature.getProperty('name') || '');
      if (name) {
        onSelectDistrict(name);
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, districtSeverity, selectedDistrict, onSelectDistrict]);

  useEffect(() => {
    return () => {
      if (!map) return;
      map.data.forEach((feature) => map.data.remove(feature));
      dataLoadedRef.current = false;
    };
  }, [map]);

  return null;
};

const MapCameraController: React.FC<{
  target: { lat: number; lng: number; zoom?: number; ts: number } | null;
}> = ({ target }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo({ lat: target.lat, lng: target.lng });
    if (target.zoom) {
      map.setZoom(target.zoom);
    }
  }, [map, target]);
  return null;
};

const UserGpsCircleOverlay: React.FC<{
  userPos: { lat: number; lng: number; accuracy: number } | null;
}> = ({ userPos }) => {
  const map = useMap();

  useEffect(() => {
    if (!map || !userPos) return;
    const circle = new google.maps.Circle({
      map,
      center: { lat: userPos.lat, lng: userPos.lng },
      radius: userPos.accuracy,
      strokeColor: '#38BDF8',
      strokeOpacity: 0.9,
      strokeWeight: 1.5,
      fillColor: '#38BDF8',
      fillOpacity: 0.18,
    });
    return () => {
      circle.setMap(null);
    };
  }, [map, userPos]);

  if (!userPos) return null;

  return (
    <AdvancedMarker
      position={{ lat: userPos.lat, lng: userPos.lng }}
      title={`Your GPS location (±${Math.round(userPos.accuracy)}m)`}
      zIndex={1200}
    >
      <div className="w-4 h-4 rounded-full bg-sky-500 border-2 border-white shadow-md" />
    </AdvancedMarker>
  );
};

const ShelterRouteLayer: React.FC<{
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number } | null;
  onRouteMetrics: (metrics: {
    distanceKm: number;
    durationMin: number | null;
    viaRoad: boolean;
    error: string | null;
  }) => void;
}> = ({ origin, destination, onRouteMetrics }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map || !destination) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    const drawFallbackLine = (errorMsg: string | null) => {
      const line = new google.maps.Polyline({
        map,
        path: [origin, destination],
        geodesic: true,
        strokeColor: '#38BDF8',
        strokeOpacity: 0.85,
        strokeWeight: 3,
      });
      polylinesRef.current = [line];
      onRouteMetrics({
        distanceKm: haversineKm(origin.lat, origin.lng, destination.lat, destination.lng),
        durationMin: null,
        viaRoad: false,
        error: errorMsg,
      });
    };

    if (!routesLib) {
      drawFallbackLine(null);
      return () => {
        polylinesRef.current.forEach((p) => p.setMap(null));
        polylinesRef.current = [];
      };
    }

    let cancelled = false;
    const request = {
      origin,
      destination,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    };

    // Modern Routes API SDK wrapper (Route.computeRoutes)
    const RouteClass = routesLib.Route as unknown as {
      computeRoutes?: (req: unknown) => Promise<{
        routes?: Array<{
          distanceMeters?: number;
          durationMillis?: number;
          createPolylines?: () => google.maps.Polyline[];
        }>;
      }>;
    };

    if (typeof RouteClass?.computeRoutes === 'function') {
      RouteClass.computeRoutes(request)
        .then((res) => {
          if (cancelled) return;
          const primaryRoute = res?.routes?.[0];
          if (!primaryRoute) {
            drawFallbackLine('No road route returned; showing direct bearing.');
            return;
          }
          const created = primaryRoute.createPolylines?.() || [];
          created.forEach((pl) => {
            pl.setOptions({ strokeColor: '#0EA5E9', strokeWeight: 5, strokeOpacity: 0.9 });
            pl.setMap(map);
          });
          polylinesRef.current = created;

          const meters = primaryRoute.distanceMeters ?? 0;
          const millis = primaryRoute.durationMillis ?? 0;
          onRouteMetrics({
            distanceKm:
              meters > 0
                ? meters / 1000
                : haversineKm(origin.lat, origin.lng, destination.lat, destination.lng),
            durationMin: millis > 0 ? Math.max(1, Math.round(millis / 60000)) : null,
            viaRoad: created.length > 0,
            error: null,
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('OVER_QUERY_LIMIT') ||
            msg.includes('429') ||
            msg.includes('Quota')
          ) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          drawFallbackLine('Road routing unavailable; showing direct line to shelter.');
        });
    } else {
      drawFallbackLine(null);
    }

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routesLib, origin.lat, origin.lng, destination?.lat, destination?.lng, onRouteMetrics]);

  return null;
};

const ReportMarkerItem: React.FC<{
  report: DisasterReport;
  fill: string;
  onMountMarker: (key: string, marker: ClusterMarker | null) => void;
  onSelect: (report: DisasterReport, key: string) => void;
}> = React.memo(({ report, fill, onMountMarker, onSelect }) => {
  const itemKey = `rep-${report.id}`;
  const markerRef = useCallback(
    (m: ClusterMarker | null) => {
      onMountMarker(itemKey, m);
    },
    [itemKey, onMountMarker]
  );
  const handleClick = useCallback(() => {
    onSelect(report, itemKey);
  }, [onSelect, report, itemKey]);

  if (report.lat === null || report.lng === null) return null;
  return (
    <AdvancedMarker
      position={{ lat: report.lat, lng: report.lng }}
      ref={markerRef}
      onClick={handleClick}
      title={`${report.severity} ${report.disasterType} in ${report.district}`}
    >
      <Pin background={fill} borderColor="#FFFFFF" glyphColor="#FFFFFF" glyphText="!" />
    </AdvancedMarker>
  );
});

const ShelterMarkerItem: React.FC<{
  shelter: Shelter;
  onMountMarker: (key: string, marker: ClusterMarker | null) => void;
  onSelect: (shelter: Shelter, key: string) => void;
}> = React.memo(({ shelter, onMountMarker, onSelect }) => {
  const itemKey = `sh-${shelter.id}`;
  const markerRef = useCallback(
    (m: ClusterMarker | null) => {
      onMountMarker(itemKey, m);
    },
    [itemKey, onMountMarker]
  );
  const handleClick = useCallback(() => {
    onSelect(shelter, itemKey);
  }, [onSelect, shelter, itemKey]);

  const bg = shelter.status === 'open' ? '#0284C7' : shelter.status === 'full' ? '#D97706' : '#64748B';
  return (
    <AdvancedMarker
      position={{ lat: shelter.lat, lng: shelter.lng }}
      ref={markerRef}
      onClick={handleClick}
      title={`${shelter.name} (${shelter.district})`}
    >
      <Pin background={bg} borderColor="#FFFFFF" glyphColor="#FFFFFF" glyphText="S" />
    </AdvancedMarker>
  );
});

const ClusteredMarkersLayer: React.FC<{
  reports: DisasterReport[];
  shelters: Shelter[];
  lang: LanguageCode;
  onSelectShelter: (s: Shelter) => void;
}> = ({ reports, shelters, lang, onSelectShelter }) => {
  const map = useMap();
  const markersMapRef = useRef<Record<string, ClusterMarker>>({});
  const [selected, setSelected] = useState<SelectedItem | null>(null);

  const clusterer = useMemo(() => {
    if (!map) return null;
    return new MarkerClusterer({ map });
  }, [map]);

  const handleMountMarker = useCallback((key: string, marker: ClusterMarker | null) => {
    if (marker) {
      markersMapRef.current[key] = marker;
    } else {
      delete markersMapRef.current[key];
    }
  }, []);

  const handleSelectReport = useCallback((report: DisasterReport, key: string) => {
    setSelected({ kind: 'report', data: report, key });
  }, []);

  const handleSelectShelterItem = useCallback(
    (shelter: Shelter, key: string) => {
      setSelected({ kind: 'shelter', data: shelter, key });
      onSelectShelter(shelter);
    },
    [onSelectShelter]
  );

  useEffect(() => {
    if (!clusterer) return;
    clusterer.clearMarkers();
    const activeMarkers = Object.values(markersMapRef.current);
    if (activeMarkers.length > 0) {
      clusterer.addMarkers(activeMarkers);
    }
  }, [clusterer, reports, shelters]);

  useEffect(() => {
    return () => {
      clusterer?.clearMarkers();
    };
  }, [clusterer]);

  const selectedAnchor = selected
    ? (markersMapRef.current[selected.key] as google.maps.marker.AdvancedMarkerElement | undefined)
    : undefined;

  return (
    <>
      {reports.map((r) => (
        <ReportMarkerItem
          key={`rep-${r.id}`}
          report={r}
          fill={SEVERITY_FILL[r.severity]}
          onMountMarker={handleMountMarker}
          onSelect={handleSelectReport}
        />
      ))}

      {shelters.map((s) => (
        <ShelterMarkerItem
          key={`sh-${s.id}`}
          shelter={s}
          onMountMarker={handleMountMarker}
          onSelect={handleSelectShelterItem}
        />
      ))}

      {selected && selectedAnchor && (
        <InfoWindow anchor={selectedAnchor} onCloseClick={() => setSelected(null)}>
          {selected.kind === 'report' ? (
            <div className="min-w-[190px] max-w-[240px] text-xs text-slate-900 space-y-1 p-0.5">
              <div className="font-bold" style={{ color: SEVERITY_FILL[selected.data.severity] }}>
                {selected.data.severity} ·{' '}
                {DISASTER_TYPE_LABELS[lang][selected.data.disasterType] || selected.data.disasterType}
              </div>
              <div className="font-semibold">{selected.data.district}</div>
              <p className="text-slate-700 leading-snug">{selected.data.description}</p>
              <div className="text-[11px] text-slate-500">
                {selected.data.peopleAffected} affected · {selected.data.status}
              </div>
            </div>
          ) : (
            <div className="min-w-[190px] max-w-[240px] text-xs text-slate-900 space-y-1 p-0.5">
              <div className="font-bold text-sky-700">
                SHELTER · {selected.data.status.toUpperCase()}
              </div>
              <div className="font-semibold">{selected.data.name}</div>
              <div className="text-slate-600">{selected.data.district}</div>
              <div>
                Occupancy:{' '}
                <b>
                  {selected.data.occupied}/{selected.data.capacity}
                </b>
              </div>
              <div className="text-slate-600">Contact: {selected.data.contactPhone}</div>
            </div>
          )}
        </InfoWindow>
      )}
    </>
  );
};

const OfflineVectorAssamMap: React.FC<{
  districtSeverity: Record<string, Severity>;
  selectedDistrict: string;
  onSelectDistrict: (d: string) => void;
  reports: DisasterReport[];
  shelters: Shelter[];
  userPos: { lat: number; lng: number } | null;
  targetShelter: Shelter | null;
}> = ({
  districtSeverity,
  selectedDistrict,
  onSelectDistrict,
  reports,
  shelters,
  userPos,
  targetShelter,
}) => {
  // Assam bounding box projection into 800x420 SVG
  const minLng = 89.6;
  const maxLng = 96.2;
  const minLat = 24.1;
  const maxLat = 28.1;
  const project = (lat: number, lng: number): [number, number] => {
    const x = ((lng - minLng) / (maxLng - minLng)) * 760 + 20;
    const y = ((maxLat - lat) / (maxLat - minLat)) * 380 + 20;
    return [x, y];
  };

  return (
    <div className="h-full w-full bg-slate-950 flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
        <span>Offline / Low-Data Vector Map (35 Assam Districts)</span>
        <span className="font-mono">{selectedDistrict}</span>
      </div>
      <svg viewBox="0 0 800 420" className="w-full h-full">
        {ASSAM_GEOJSON.features.map((f) => {
          const name = String(f.properties.name);
          const sev = districtSeverity[name];
          const isSelected = name === selectedDistrict;
          const ring = f.geometry.coordinates[0] || [];
          const pts = ring
            .map(([lng, lat]) => {
              const [x, y] = project(lat, lng);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
          return (
            <polygon
              key={name}
              points={pts}
              fill={sev ? SEVERITY_FILL[sev] : '#1E293B'}
              fillOpacity={sev ? (isSelected ? 0.55 : 0.35) : isSelected ? 0.4 : 0.25}
              stroke={isSelected ? '#38BDF8' : '#475569'}
              strokeWidth={isSelected ? 2.4 : 1}
              className="cursor-pointer transition-opacity hover:opacity-90"
              onClick={() => onSelectDistrict(name)}
            >
              <title>{`${name} · ${sev || 'NOMINAL'}`}</title>
            </polygon>
          );
        })}

        {userPos && targetShelter && (() => {
          const [x1, y1] = project(userPos.lat, userPos.lng);
          const [x2, y2] = project(targetShelter.lat, targetShelter.lng);
          return (
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#38BDF8"
              strokeWidth={2}
              strokeDasharray="6 5"
            />
          );
        })()}

        {shelters.map((s) => {
          const [x, y] = project(s.lat, s.lng);
          return (
            <rect
              key={s.id}
              x={x - 4}
              y={y - 4}
              width={8}
              height={8}
              rx={2}
              fill={s.status === 'open' ? '#0EA5E9' : '#D97706'}
              stroke="#FFFFFF"
              strokeWidth={1.2}
            >
              <title>{`${s.name} (${s.occupied}/${s.capacity})`}</title>
            </rect>
          );
        })}

        {reports.map((r) => {
          if (r.lat === null || r.lng === null) return null;
          const [x, y] = project(r.lat, r.lng);
          return (
            <circle
              key={r.id}
              cx={x}
              cy={y}
              r={4.5}
              fill={SEVERITY_FILL[r.severity]}
              stroke="#FFFFFF"
              strokeWidth={1.2}
            >
              <title>{`${r.severity} ${r.disasterType} · ${r.district}`}</title>
            </circle>
          );
        })}

        {userPos && (() => {
          const [ux, uy] = project(userPos.lat, userPos.lng);
          return <circle cx={ux} cy={uy} r={6} fill="#38BDF8" stroke="#FFFFFF" strokeWidth={2} />;
        })()}
      </svg>
    </div>
  );
};

const GoogleMapContent: React.FC<{
  tileMode: TileMode;
  districtSeverity: Record<string, Severity>;
  selectedDistrict: string;
  onSelectDistrict: (name: string) => void;
  filteredReports: DisasterReport[];
  shelters: Shelter[];
  lang: LanguageCode;
  userPos: { lat: number; lng: number; accuracy: number } | null;
  flyTarget: { lat: number; lng: number; zoom?: number; ts: number } | null;
  routeOrigin: { lat: number; lng: number };
  activeTargetShelter: Shelter | null;
  onSelectShelter: (s: Shelter) => void;
  onRouteMetrics: (m: {
    distanceKm: number;
    durationMin: number | null;
    viaRoad: boolean;
    error: string | null;
  }) => void;
  fallbackProps: {
    districtSeverity: Record<string, Severity>;
    selectedDistrict: string;
    onSelectDistrict: (d: string) => void;
    reports: DisasterReport[];
    shelters: Shelter[];
    userPos: { lat: number; lng: number } | null;
    targetShelter: Shelter | null;
  };
}> = ({
  tileMode,
  districtSeverity,
  selectedDistrict,
  onSelectDistrict,
  filteredReports,
  shelters,
  lang,
  userPos,
  flyTarget,
  routeOrigin,
  activeTargetShelter,
  onSelectShelter,
  onRouteMetrics,
  fallbackProps,
}) => {
  const apiStatus = useApiLoadingStatus();

  if (apiStatus === APILoadingStatus.FAILED || apiStatus === APILoadingStatus.AUTH_FAILURE) {
    return <OfflineVectorAssamMap {...fallbackProps} />;
  }

  return (
    <GoogleMap
      mapId="DEMO_MAP_ID"
      defaultCenter={ASSAM_CENTER}
      defaultZoom={7}
      mapTypeId={tileMode}
      gestureHandling="greedy"
      streetViewControl={false}
      fullscreenControl
      mapTypeControl={false}
      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
      className="h-full w-full"
    >
      <DistrictGeoJsonLayer
        districtSeverity={districtSeverity}
        selectedDistrict={selectedDistrict}
        onSelectDistrict={onSelectDistrict}
      />
      <ClusteredMarkersLayer
        reports={filteredReports}
        shelters={shelters}
        lang={lang}
        onSelectShelter={onSelectShelter}
      />
      <UserGpsCircleOverlay userPos={userPos} />
      <ShelterRouteLayer
        origin={routeOrigin}
        destination={
          activeTargetShelter ? { lat: activeTargetShelter.lat, lng: activeTargetShelter.lng } : null
        }
        onRouteMetrics={onRouteMetrics}
      />
      <MapCameraController target={flyTarget} />
    </GoogleMap>
  );
};

export const DisasterMapView: React.FC<{ lang: LanguageCode; lowDataMode: boolean }> = ({
  lang,
  lowDataMode,
}) => {
  const { reports, shelters, alerts, sosList, isOnline } = useAppData();
  const t = TRANSLATIONS[lang];

  const [tileMode, setTileMode] = useState<TileMode>('roadmap');
  const [disasterFilter, setDisasterFilter] = useState<'all' | DisasterType>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('Kamrup Metropolitan');

  const [userPos, setUserPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [tracking, setTracking] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom?: number; ts: number } | null>(
    null
  );
  const [selectedShelter, setSelectedShelter] = useState<Shelter | null>(null);
  const [routeMetrics, setRouteMetrics] = useState<{
    distanceKm: number;
    durationMin: number | null;
    viaRoad: boolean;
    error: string | null;
  } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const filteredReports = useMemo(() => {
    const now = Date.now();
    const cutoff =
      timeRange === '24h'
        ? now - 24 * 3600 * 1000
        : timeRange === '72h'
          ? now - 72 * 3600 * 1000
          : timeRange === '7d'
            ? now - 7 * 24 * 3600 * 1000
            : 0;

    return reports.filter((r) => {
      if (r.status === 'REJECTED') return false;
      if (disasterFilter !== 'all' && r.disasterType !== disasterFilter) return false;
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
      if (cutoff > 0 && r.createdAt < cutoff) return false;
      return true;
    });
  }, [reports, disasterFilter, severityFilter, timeRange]);

  const districtSeverity = useMemo(() => {
    const now = Date.now();
    const sevMap: Record<string, Severity> = {};
    const bump = (district: string, sev: Severity) => {
      const cur = sevMap[district];
      if (!cur || SEVERITY_RANK[sev] > SEVERITY_RANK[cur]) {
        sevMap[district] = sev;
      }
    };

    for (const r of filteredReports) bump(r.district, r.severity);
    for (const a of alerts) {
      if (a.expiresAt > now) {
        for (const d of a.districts) bump(d, a.severity);
      }
    }
    for (const s of sosList) {
      if (s.status !== 'RESOLVED') bump(s.district, 'CRITICAL');
    }
    return sevMap;
  }, [filteredReports, alerts, sosList]);

  const nearestShelter = useMemo(() => {
    const origin = userPos || { lat: 26.1445, lng: 91.7362 };
    const openOnes = shelters.filter((s) => s.status === 'open');
    const pool = openOnes.length > 0 ? openOnes : shelters;
    if (pool.length === 0) return null;
    let best = pool[0];
    let bestDist = Infinity;
    for (const s of pool) {
      const d = haversineKm(origin.lat, origin.lng, s.lat, s.lng);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return { shelter: best, distanceKm: bestDist, origin };
  }, [userPos, shelters]);

  const activeTargetShelter = selectedShelter || nearestShelter?.shelter || null;
  const routeOrigin = userPos || { lat: 26.1445, lng: 91.7362 };
  const fallbackDistanceKm = activeTargetShelter
    ? haversineKm(routeOrigin.lat, routeOrigin.lng, activeTargetShelter.lat, activeTargetShelter.lng)
    : null;

  const districtInfo = useMemo(() => {
    const now = Date.now();
    const dSeed = getDistrictSeed(selectedDistrict);
    const dReports = filteredReports.filter((r) => r.district === selectedDistrict);
    const dShelters = shelters.filter((s) => s.district === selectedDistrict);
    const dAlerts = alerts.filter((a) => a.expiresAt > now && a.districts.includes(selectedDistrict));
    return {
      seed: dSeed,
      severity: districtSeverity[selectedDistrict] || null,
      reports: dReports,
      shelters: dShelters,
      alerts: dAlerts,
    };
  }, [selectedDistrict, filteredReports, shelters, alerts, districtSeverity]);

  const locateOnce = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 50,
        };
        setUserPos(next);
        setFlyTarget({ lat: next.lat, lng: next.lng, zoom: 11, ts: Date.now() });
      },
      (err) => setGpsError(err.message || 'Unable to retrieve GPS location.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (!tracking) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    if (!navigator.geolocation) {
      setGpsError('Live GPS tracking unavailable.');
      setTracking(false);
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 50,
        });
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [tracking]);

  const jumpToDistrict = (name: string) => {
    setSelectedDistrict(name);
    const seed = getDistrictSeed(name);
    if (seed) {
      setFlyTarget({ lat: seed.lat, lng: seed.lng, zoom: 10, ts: Date.now() });
    }
  };

  const handleRouteMetrics = useCallback(
    (m: { distanceKm: number; durationMin: number | null; viaRoad: boolean; error: string | null }) => {
      setRouteMetrics(m);
    },
    []
  );

  const canRenderGoogleMaps = isOnline && !lowDataMode && Boolean(MAPS_API_KEY);

  return (
    <div className="space-y-4">
      {/* Map Controls & Filters Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 mr-1">
            <Filter className="w-3.5 h-3.5" aria-hidden="true" />
            Filters:
          </span>

          <select
            aria-label="Jump to Assam district"
            value={selectedDistrict}
            onChange={(e) => jumpToDistrict(e.target.value)}
            className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-medium"
          >
            {ASSAM_DISTRICTS.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} ({d.region})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by disaster type"
            value={disasterFilter}
            onChange={(e) => setDisasterFilter(e.target.value as 'all' | DisasterType)}
            className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-medium"
          >
            <option value="all">All Disasters</option>
            {(['flood', 'landslide', 'storm', 'earthquake', 'fire', 'lightning'] as DisasterType[]).map((d) => (
              <option key={d} value={d}>
                {DISASTER_TYPE_LABELS[lang][d]}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as 'all' | Severity)}
            className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-medium"
          >
            <option value="all">All Severities</option>
            <option value="CRITICAL">{t.critical}</option>
            <option value="HIGH">{t.high}</option>
            <option value="MODERATE">{t.moderate}</option>
            <option value="LOW">{t.low}</option>
          </select>

          <select
            aria-label="Filter by time range"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-medium"
          >
            <option value="all">All Time</option>
            <option value="24h">Last 24h</option>
            <option value="72h">Last 72h</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs">
            <Layers className="w-3.5 h-3.5 mx-2 text-slate-500" aria-hidden="true" />
            {(
              [
                { id: 'roadmap', label: 'Street' },
                { id: 'satellite', label: 'Satellite' },
                { id: 'terrain', label: 'Terrain' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setTileMode(mode.id)}
                className={`min-h-[34px] px-2.5 rounded-lg font-medium transition-colors ${
                  tileMode === mode.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={locateOnce}
            className="min-h-[40px] px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <LocateFixed className="w-3.5 h-3.5" aria-hidden="true" />
            <span>My GPS</span>
          </button>

          <button
            type="button"
            onClick={() => setTracking((v) => !v)}
            className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap ${
              tracking
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            {tracking ? 'Live GPS: On' : 'Live GPS: Off'}
          </button>
        </div>
      </div>

      {gpsError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          GPS notice: {gpsError}. Showing Guwahati center for distance calculation until GPS is granted.
        </div>
      )}

      {(lowDataMode || !isOnline || !MAPS_API_KEY) && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-700 dark:text-sky-300">
          {!isOnline
            ? 'Offline Mode active: Rendering cached Assam 35-district vector map with shelters and incidents.'
            : lowDataMode
              ? 'Low-Data Mode active: Google Maps satellite/street tiles paused to conserve bandwidth. Vector 35-district boundaries remain interactive.'
              : 'Google Maps API key pending: Displaying interactive Assam 35-district vector map fallback.'}
        </div>
      )}

      {/* Map + District Intelligence + Nearest Shelter */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 h-[64vh] min-h-[440px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900">
          {canRenderGoogleMaps ? (
            <APIProvider
              apiKey={MAPS_API_KEY}
              language="en"
              region="IN"
              libraries={['marker', 'routes']}
            >
              <GoogleMapContent
                tileMode={tileMode}
                districtSeverity={districtSeverity}
                selectedDistrict={selectedDistrict}
                onSelectDistrict={setSelectedDistrict}
                filteredReports={filteredReports}
                shelters={shelters}
                lang={lang}
                userPos={userPos}
                flyTarget={flyTarget}
                routeOrigin={routeOrigin}
                activeTargetShelter={activeTargetShelter}
                onSelectShelter={setSelectedShelter}
                onRouteMetrics={handleRouteMetrics}
                fallbackProps={{
                  districtSeverity,
                  selectedDistrict,
                  onSelectDistrict: setSelectedDistrict,
                  reports: filteredReports,
                  shelters,
                  userPos,
                  targetShelter: activeTargetShelter,
                }}
              />
            </APIProvider>
          ) : (
            <OfflineVectorAssamMap
              districtSeverity={districtSeverity}
              selectedDistrict={selectedDistrict}
              onSelectDistrict={setSelectedDistrict}
              reports={filteredReports}
              shelters={shelters}
              userPos={userPos}
              targetShelter={activeTargetShelter}
            />
          )}
        </div>

        {/* Right Intelligence Sidebar */}
        <aside className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            {/* Selected District Inspector */}
            <div className="space-y-2 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-sky-500" aria-hidden="true" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{selectedDistrict}</h3>
                </div>
                {districtInfo.severity && <SeverityIndicator severity={districtInfo.severity} lang={lang} />}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {districtInfo.seed?.region || 'Assam'} · {districtInfo.reports.length} report(s) ·{' '}
                {districtInfo.shelters.length} shelter(s) · {districtInfo.alerts.length} active alert(s)
              </p>
              <button
                type="button"
                onClick={() => jumpToDistrict(selectedDistrict)}
                className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
              >
                Center Map on {selectedDistrict}
              </button>
            </div>

            {/* Nearest Shelter */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t.nearestShelter}</h3>
              </div>

              {activeTargetShelter && fallbackDistanceKm !== null ? (
                <div className="space-y-2.5 text-xs">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{activeTargetShelter.name}</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    {activeTargetShelter.district} · {activeTargetShelter.address}
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-1 font-mono tabular-nums">
                    <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2.5">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {routeMetrics?.viaRoad ? 'Road Route' : 'Distance'}
                      </div>
                      <div className="text-sm font-bold text-sky-600 dark:text-sky-400">
                        {(routeMetrics?.distanceKm ?? fallbackDistanceKm).toFixed(1)} km
                        {routeMetrics?.durationMin ? ` · ${routeMetrics.durationMin}m` : ''}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2.5">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Beds Left</div>
                      <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {Math.max(0, activeTargetShelter.capacity - activeTargetShelter.occupied)}
                      </div>
                    </div>
                  </div>
                  {routeMetrics?.error && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">{routeMetrics.error}</p>
                  )}
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${activeTargetShelter.lat},${activeTargetShelter.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full min-h-[44px] rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5"
                  >
                    Open Turn-by-Turn Route
                  </a>
                  {selectedShelter && (
                    <button
                      type="button"
                      onClick={() => setSelectedShelter(null)}
                      className="w-full text-xs text-slate-500 hover:underline py-1"
                    >
                      Reset to Nearest Open Shelter
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">No shelters loaded.</p>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
            <p className="font-semibold text-slate-700 dark:text-slate-300">District Risk Choropleth (35)</p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> {t.critical}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-orange-500 inline-block" /> {t.high}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" /> {t.moderate}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> {t.low}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              {filteredReports.length} incident pins · {shelters.length} shelters
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};
