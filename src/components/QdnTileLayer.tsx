import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * Convert tile coords (zoom, x, y) to Leaflet LatLng.
 * Pass integer tile indices to get the top-left corner of that tile,
 * or fractional values for arbitrary positions within the tile grid
 * (e.g. x+0.5, y+0.5 for the center of a tile; x+1, y+1 for the
 * corner between four tiles).
 */
export function tileToLatLng(z: number, x: number, y: number): L.LatLngLiteral {
  const n = Math.pow(2, z);
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lat: (latRad * 180) / Math.PI, lng };
}

/** Convert map center and zoom to tile indices (x, y) */
export function latLngToTile(
  z: number,
  lat: number,
  lng: number
): { x: number; y: number } {
  const n = Math.pow(2, z);
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    (1 -
      (Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI + 1) / 2) *
    n;
  return { x: Math.floor(x), y: Math.floor(y) };
}

export interface MapViewSyncProps {
  zoom: number;
  x: number;
  y: number;
  setZoom: (z: number) => void;
  setX: (x: number) => void;
  setY: (y: number) => void;
}

const MAX_ZOOM = 20;
const MIN_ZOOM = 1;

/** Syncs Leaflet map view with zoom/x/y state and vice versa */
export function MapViewSync({
  zoom,
  x,
  y,
  setZoom,
  setX,
  setY,
}: MapViewSyncProps) {
  const map = useMap();
  const skipNextSyncRef = useRef(false);
  const stateFromMapRef = useRef(false);

  useEffect(() => {
    map.setMaxZoom(MAX_ZOOM);
    map.setMinZoom(MIN_ZOOM);
  }, [map]);

  useEffect(() => {
    if (stateFromMapRef.current) {
      stateFromMapRef.current = false;
      return;
    }
    skipNextSyncRef.current = true;
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const center = tileToLatLng(clampedZoom, x + 0.5, y + 0.5);
    map.setView(center, clampedZoom, { animate: false });
  }, [map, zoom, x, y]);

  useEffect(() => {
    const onMoveEnd = () => {
      if (skipNextSyncRef.current) {
        skipNextSyncRef.current = false;
        return;
      }
      stateFromMapRef.current = true;
      let z = map.getZoom();
      z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
      const c = map.getCenter();
      const { x: tx, y: ty } = latLngToTile(z, c.lat, c.lng);
      const maxTile = Math.pow(2, z);
      const clampedX = Math.max(0, Math.min(tx, maxTile - 1));
      const clampedY = Math.max(0, Math.min(ty, maxTile - 1));
      setZoom(z);
      setX(clampedX);
      setY(clampedY);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('moveend', onMoveEnd);
    };
  }, [map, setZoom, setX, setY]);

  return null;
}

/** Sets the map view to the given center and zoom (e.g. for a preview map that must show a fixed view). */
export function SetPreviewView({
  center,
  zoom,
}: {
  center: L.LatLngLiteral;
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: false });
  }, [map, center.lat, center.lng, zoom]);
  return null;
}

export type FetchTileImage = (
  z: number,
  x: number,
  y: number
) => Promise<string | null>;

interface QdnTileLayerProps {
  fetchTileImage: FetchTileImage;
}

type QdnGridLayerConstructor = new (
  options?: L.GridLayerOptions
) => L.GridLayer;

/**
 * Custom Leaflet GridLayer that fetches tile images asynchronously via QDN.
 * Each tile is requested with identifier `${z}-${x}-${y}` and the result (data URL or error) is set on the tile image.
 */
function createQdnGridLayer(
  fetchTileImage: FetchTileImage
): QdnGridLayerConstructor {
  return L.GridLayer.extend({
    createTile(coords: L.Coords): HTMLElement {
      const tile = document.createElement('div');
      tile.style.width = '256px';
      tile.style.height = '256px';
      tile.style.display = 'flex';
      tile.style.alignItems = 'center';
      tile.style.justifyContent = 'center';
      tile.style.textAlign = 'center';
      tile.style.padding = '8px';
      tile.style.boxSizing = 'border-box';
      tile.style.fontSize = '12px';
      tile.style.color = '#666';
      tile.style.background = 'rgba(0,0,0,0.06)';
      tile.style.border = '1px solid rgba(0,0,0,0.08)';
      tile.textContent = 'Loading…';

      fetchTileImage(coords.z, coords.x, coords.y)
        .then((src) => {
          if (
            src &&
            (src.startsWith('data:image/') || src.startsWith('blob:'))
          ) {
            tile.textContent = '';
            tile.style.background = 'transparent';
            tile.style.border = 'none';
            tile.style.padding = '0';
            const img = document.createElement('img');
            img.alt = '';
            img.role = 'presentation';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.display = 'block';
            img.src = src;
            tile.appendChild(img);
          } else {
            tile.style.color = '#555';
            tile.style.whiteSpace = 'pre-wrap';
            tile.style.wordBreak = 'break-all';
            tile.textContent =
              src && (src.startsWith('Error') || src.startsWith('Missing'))
                ? src
                : src || 'Loading…';
          }
        })
        .catch(() => {
          tile.style.background = 'rgba(255,0,0,0.08)';
          tile.style.color = '#c00';
          tile.textContent = 'Error loading tile';
        });

      return tile;
    },
  }) as QdnGridLayerConstructor;
}

export function QdnTileLayer({ fetchTileImage }: QdnTileLayerProps) {
  const map = useMap();

  useEffect(() => {
    const LayerClass = createQdnGridLayer(fetchTileImage);
    const layer = new LayerClass({
      tileSize: 256,
      maxZoom: 20,
      minZoom: 1,
      maxNativeZoom: 20,
      noWrap: true,
      updateWhenIdle: false,
      updateWhenZooming: true,
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, fetchTileImage]);

  return null;
}
