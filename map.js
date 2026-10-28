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
// Safety: popups are built from page elements filled with textContent and
// handed over with Popup.setDOMContent, never setHTML, so station and route
// names can only ever show as text. The map never touches the AI or the prompt.

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

// Most stations a cluster popup lists. A cluster can hold dozens on the
// Northeast Corridor; past this the popup says how many more and offers Zoom in.
export const CLUSTER_LIST_LIMIT = 50

// The preview shown in a map popup, from one /api/destination response
// (destination.js). Pure (data in, data out) so test/map.test.js can check it.
//   { status }                         a one-line message instead of numbers
//   { from, stats: [[value, label]], routes, moreRoutes }
export function previewModel(d) {
  if (!d || !d.ok) return { status: d?.notes?.[0] ?? 'No schedule data for this station.' }
  const from = d.from?.name ?? 'your station'
  if (d.outsideFeed) return { status: `No schedule data for ${d.date}.` }
  if (!d.trainsPerDay) return { status: `No direct train from ${from} today.` }
  return {
    from,
    stats: [
      [String(d.trainsPerDay), d.trainsPerDay === 1 ? 'train today' : 'trains today'],
      [d.fastest.duration, 'fastest'],
      [`${d.earliest.depart} – ${d.latest.depart}`, 'first – last (ET)'],
    ],
    routes: d.routes.slice(0, 3),
    moreRoutes: Math.max(0, d.routes.length - 3),
  }
}

// Draws a previewModel as page elements. Text only (textContent), never HTML,
// so a hostile station or route name can only ever show as text. `doc` is the
// page's document (a fake one in tests).
export function buildPreview(doc, model) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }
  const box = el('div', 'map-preview')
  if (model.status) {
    box.append(el('p', 'map-preview-status', model.status))
    return box
  }
  box.append(el('p', 'map-preview-from', `From ${model.from} · today`))
  const grid = el('div', 'map-preview-stats')
  for (const [value, label] of model.stats) {
    const stat = el('div', 'map-preview-stat')
    stat.append(el('span', 'map-preview-value', value), el('span', 'map-preview-label', label))
    grid.append(stat)
  }
  box.append(grid)
  if (model.routes.length) {
    const routes = el('p', 'map-preview-routes', model.routes.join(' · ') + (model.moreRoutes ? ` +${model.moreRoutes} more` : ''))
    box.append(routes)
  }
  return box
}

// initMap(container, { fetchStations, loadPreview, onOpen, homeId, loadLibrary?, doc? })
//   fetchStations  async () => [{ id, name, lat, lon }]
//   loadPreview    async (stopId) => /api/destination data for the home station -> stopId
//   onOpen         (id, name) => void, when a station's preview is opened (for logging)
//   homeId         the home station's stop_id (highlighted)
//   loadLibrary    for tests; defaults to importing MapLibre from the CDN
//   doc            for tests; defaults to the page's document
// Returns { setHome(id) } so the "Your station" picker can move the highlight.
export async function initMap(container, {
  fetchStations, loadPreview, onOpen = () => {}, homeId,
  loadLibrary = () => import(MAPLIBRE_URL), doc = globalThis.document,
}) {
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

  // ---- Popups ----
  // Every piece of text goes in through textContent (see buildPreview).
  const el = (tag, className, text) => {
    const node = doc.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  // Previews are fetched when opened, once per (home station, station) for this
  // visit. A failed fetch is forgotten so opening it again retries.
  let currentHome = homeId
  const previews = new Map()
  const previewFor = (id) => {
    const key = `${currentHome}>${id}`
    if (!previews.has(key)) {
      previews.set(key, Promise.resolve().then(() => loadPreview(id)).catch((err) => { previews.delete(key); throw err }))
    }
    return previews.get(key)
  }
  const fillPreview = async (slot, id) => {
    slot.replaceChildren(el('p', 'map-preview-status', 'Loading…'))
    try {
      slot.replaceChildren(buildPreview(doc, previewModel(await previewFor(id))))
    } catch (err) {
      slot.replaceChildren(el('p', 'map-preview-status', `Couldn't load trains (${err.message}).`))
    }
  }

  // One popup at a time. On a phone the map is short, so a popup can run off
  // its edge. Each popup opens on a fixed side of its point, and the map slides
  // so the point sits where that side has room: station previews open ABOVE
  // the pin (pin moved low), cluster lists open BELOW it (point moved high).
  let popup = null
  const openPopup = (coordinates, content, anchor) => {
    popup?.remove()
    popup = new Popup({ offset: 10, maxWidth: '300px', className: 'map-pop', anchor })
      .setLngLat(coordinates).setDOMContent(content).addTo(map)
    const height = map.getCanvas().clientHeight || 320
    const shift = anchor === 'bottom' ? 0.3 : -0.38 // fraction of the height, from the centre
    map.easeTo({ center: coordinates, offset: [0, Math.round(height * shift)] })
    return popup
  }

  // Tapping a station: its name, then the preview right in the popup.
  const openStation = (e) => {
    const feature = e.features?.[0]
    if (!feature) return
    const { id, name } = feature.properties
    const content = el('div', 'map-pop-body')
    const slot = el('div')
    content.append(el('p', 'map-pop-title', name), el('p', 'map-pop-id', id), slot)
    openPopup(feature.geometry.coordinates, content, 'bottom')
    fillPreview(slot, id)
    onOpen(id, name)
  }
  map.on('click', 'station', openStation)
  map.on('click', 'home', openStation)

  // Tapping a cluster: every station in it as a dropdown (<details>), each
  // loading its preview when first opened, plus a Zoom in button.
  map.on('click', 'clusters', async (e) => {
    const feature = e.features?.[0]
    if (!feature) return
    const source = map.getSource('stations')
    const clusterId = feature.properties.cluster_id
    const total = feature.properties.point_count
    const leaves = await source.getClusterLeaves(clusterId, CLUSTER_LIST_LIMIT, 0)
    const stationsIn = leaves.map((f) => f.properties).sort((a, b) => a.name.localeCompare(b.name))

    const content = el('div', 'map-pop-body')
    content.append(el('p', 'map-pop-title', `${total} stations`))
    const list = el('div', 'map-cluster-list')
    for (const { id, name } of stationsIn) {
      const item = el('details', 'map-cluster-item')
      const slot = el('div')
      item.append(el('summary', null, name), slot)
      let loaded = false
      item.addEventListener('toggle', () => {
        if (!item.open || loaded) return
        loaded = true
        fillPreview(slot, id)
        onOpen(id, name)
      })
      list.append(item)
    }
    content.append(list)
    if (total > stationsIn.length) {
      content.append(el('p', 'map-preview-status', `+${total - stationsIn.length} more. Zoom in to see them.`))
    }
    const zoomButton = el('button', 'map-zoom-in', 'Zoom in')
    zoomButton.type = 'button'
    zoomButton.addEventListener('click', async () => {
      const zoom = await source.getClusterExpansionZoom(clusterId)
      popup?.remove()
      map.easeTo({ center: feature.geometry.coordinates, zoom })
    })
    content.append(zoomButton)
    openPopup(feature.geometry.coordinates, content, 'top')
  })

  for (const layer of ['clusters', 'station', 'home']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
  }

  return {
    stationCount: stations.length,
    setHome(id) {
      currentHome = id
      popup?.remove() // its numbers were "from" the old home station
      map.getSource('stations').setData(stationsGeoJSON(stations, id))
      map.getSource('home').setData(homeGeoJSON(stations, id))
    },
  }
}
