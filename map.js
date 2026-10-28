// The station map (PRD §7 "Map"): MapLibre GL JS + OpenFreeMap tiles, decided
// 2026-10-28. No API key, no account, nothing secret in the browser.
//
// What MapLibre is: a JavaScript library that draws an interactive map in a
// <div> from "vector tiles" (map data sent as shapes, styled in the browser).
// OpenFreeMap is a free server for those tiles and a ready-made style.
//
// MapLibre v6 ships only as an ES module, so it is loaded with import() from a
// CDN, pinned to an exact version. It is loaded LAZILY (when the map scrolls
// into view) so the rest of the page never waits for it, and if the CDN or the
// tile server is down, only this card shows an error.
//
// Safety: station names reach the map only through Popup.setText (plain text,
// never HTML). The map never touches the AI or the prompt.

export const MAPLIBRE_VERSION = '6.13.0'
export const MAPLIBRE_URL = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.mjs`
export const MAPLIBRE_CSS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`
// OpenFreeMap's light "Positron" style (https://openfreemap.org/quick_start/).
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
// Roughly the Northeast Corridor; the whole network is a pinch away.
export const START_VIEW = { center: [-75.6, 40.5], zoom: 4.8 }

// Stations ({ id, name, lat, lon }) -> a GeoJSON FeatureCollection, the format
// MapLibre draws from. Pure, so test/map.test.js can check it.
export function stationsGeoJSON(stations, homeId) {
  return {
    type: 'FeatureCollection',
    features: stations
      .filter((s) => s.id !== homeId)
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { id: s.id, name: s.name },
      })),
  }
}

// The home station gets its own, never-clustered source so it is always visible.
export function homeGeoJSON(stations, homeId) {
  const home = stations.find((s) => s.id === homeId)
  return {
    type: 'FeatureCollection',
    features: home
      ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [home.lon, home.lat] }, properties: { id: home.id, name: home.name } }]
      : [],
  }
}

// Reads a Stamp blues token from :root, so the map uses the same colours as the page.
const token = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

// initMap(container, { fetchStations, onPick, homeId, loadLibrary? })
//   fetchStations  async () => [{ id, name, lat, lon }]
//   onPick         (id, name) => void, when a station pin is clicked
//   homeId         the home station's stop_id (highlighted)
//   loadLibrary    for tests; defaults to importing MapLibre from the CDN
// Returns { setHome(id) } so the "Your station" picker can move the highlight.
export async function initMap(container, { fetchStations, onPick, homeId, loadLibrary = () => import(MAPLIBRE_URL) }) {
  const [lib, stations] = await Promise.all([loadLibrary(), fetchStations()])
  const { Map: MapLibreMap, Popup, NavigationControl } = lib

  const indigo = token('--surface-2', '#33308a')
  const ink = token('--surface-1', '#1a1856')
  const paper = token('--surface-4', '#f2f1ea')
  const lavender = token('--accent-1', '#c6c3f0')

  const map = new MapLibreMap({
    container,
    style: STYLE_URL,
    center: START_VIEW.center,
    zoom: START_VIEW.zoom,
    attributionControl: { compact: true },
    cooperativeGestures: true, // one finger scrolls the page on a phone; two move the map
  })
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

  // Only a failure to load the STYLE stops the map. MapLibre also reports
  // single tile or font misses as 'error'; those just leave a gap, so they must
  // not hide the whole map.
  await new Promise((resolve, reject) => {
    map.once('load', resolve)
    const onError = (e) => {
      if (map.isStyleLoaded()) return
      map.off('error', onError)
      reject(e?.error ?? new Error('map style failed to load'))
    }
    map.on('error', onError)
    map.once('load', () => map.off('error', onError))
  })

  // Nearby stations merge into numbered circles until you zoom in.
  map.addSource('stations', {
    type: 'geojson',
    data: stationsGeoJSON(stations, homeId),
    cluster: true,
    clusterRadius: 36,
    clusterMaxZoom: 8,
  })
  map.addSource('home', { type: 'geojson', data: homeGeoJSON(stations, homeId) })

  map.addLayer({
    id: 'clusters', type: 'circle', source: 'stations', filter: ['has', 'point_count'],
    paint: {
      'circle-color': indigo,
      'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 40, 22],
      'circle-stroke-color': paper, 'circle-stroke-width': 2,
    },
  })
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'stations', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 },
    paint: { 'text-color': paper },
  })
  map.addLayer({
    id: 'station', type: 'circle', source: 'stations', filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': indigo, 'circle-radius': 5, 'circle-stroke-color': paper, 'circle-stroke-width': 1.5 },
  })
  map.addLayer({
    id: 'home', type: 'circle', source: 'home',
    paint: { 'circle-color': lavender, 'circle-radius': 8, 'circle-stroke-color': ink, 'circle-stroke-width': 2.5 },
  })

  // Clicking a cluster zooms in to split it.
  map.on('click', 'clusters', async (e) => {
    const feature = e.features?.[0]
    if (!feature) return
    const zoom = await map.getSource('stations').getClusterExpansionZoom(feature.properties.cluster_id)
    map.easeTo({ center: feature.geometry.coordinates, zoom })
  })

  // Clicking a station: a text-only label, then hand the id to the page.
  const pick = (e) => {
    const feature = e.features?.[0]
    if (!feature) return
    const { id, name } = feature.properties
    new Popup({ closeButton: false, offset: 10 }).setLngLat(feature.geometry.coordinates).setText(name).addTo(map)
    onPick(id, name)
  }
  map.on('click', 'station', pick)
  map.on('click', 'home', pick)

  for (const layer of ['clusters', 'station', 'home']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
  }

  return {
    stationCount: stations.length,
    setHome(id) {
      map.getSource('stations').setData(stationsGeoJSON(stations, id))
      map.getSource('home').setData(homeGeoJSON(stations, id))
    },
  }
}
