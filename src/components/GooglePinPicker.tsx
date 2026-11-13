import React from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
} from '@vis.gl/react-google-maps';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export const GooglePinPicker: React.FC<{
  lat: number;
  lng: number;
  pinColor?: string;
  lowDataMode?: boolean;
  isOnline?: boolean;
  onPick: (lat: number, lng: number) => void;
}> = ({ lat, lng, pinColor = '#EF4444', lowDataMode = false, isOnline = true, onPick }) => {
  if (lowDataMode || !isOnline || !MAPS_API_KEY) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-950 p-4 text-center text-xs text-slate-600 dark:text-slate-400">
        <p className="font-semibold text-slate-800 dark:text-slate-200">
          {!isOnline
            ? 'Offline Pin Mode Active'
            : lowDataMode
              ? 'Low-Data Mode Active'
              : 'Interactive Pin Coordinates'}
        </p>
        <p className="font-mono mt-1">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
        <p className="mt-1 text-[11px] opacity-80">
          Tap Refresh GPS or adjust coordinates manually when back online.
        </p>
      </div>
    );
  }

  return (
    <APIProvider apiKey={MAPS_API_KEY} language="en" region="IN" libraries={['marker']}>
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={{ lat, lng }}
        center={{ lat, lng }}
        defaultZoom={11}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        className="h-full w-full"
        onClick={(ev) => {
          const ll = ev.detail.latLng;
          if (ll) {
            onPick(ll.lat, ll.lng);
          }
        }}
      >
        <AdvancedMarker position={{ lat, lng }}>
          <Pin background={pinColor} borderColor="#FFFFFF" glyphColor="#FFFFFF" />
        </AdvancedMarker>
      </GoogleMap>
    </APIProvider>
  );
};
