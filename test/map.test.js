// map.js: the GeoJSON conversion, the popup preview, and initMap() against a
// FAKE MapLibre and a tiny FAKE document (no browser, no network). The fakes
// record what the page asks for, so we can check the wiring: layers, clicks,
// previews, cluster lists, and that every name goes in as TEXT.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stationsGeoJSON, homeGeoJSON, previewModel, buildPreview, initMap,
  MAPLIBRE_URL, MAPLIBRE_CSS, STYLE_URL, CLUSTER_LIST_LIMIT, TAP_RADIUS, nearestFeature,
} from '../map.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EVIL = '<img src=x onerror=alert(1)>'
const STATIONS = [
  { id: 'NYP', name: 'New York Penn Station', lat: 40.75, lon: -73.99 },
  { id: 'PHL', name: 'Philadelphia 30th Street', lat: 39.96, lon: -75.18 },
  { id: 'X1', name: EVIL, lat: 41, lon: -74 },
]

// An /api/destination response (destination.js) for NYP -> PHL.
const PHL_SUMMARY = {
  ok: true, outsideFeed: false, date: '2026-10-28', weekday: 'wednesday',
  from: { stop_id: 'NYP', name: 'New York Penn Station' }, to: { stop_id: 'PHL', name: 'Philadelphia' },
  trainsPerDay: 41,
  fastest: { train: '2133', duration: '1h 08m' }, median: { minutes: 85, duration: '1h 25m' },
  earliest: { depart: '12:20 AM' }, latest: { depart: '11:23 PM' },
  routes: ['Northeast Regional', 'Acela', 'Keystone Service', 'Cardinal', 'Palmetto'],
}

// ---- a tiny fake document: just enough DOM for map.js ----
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.listeners = {}; this._text = null; this.open = false }
  set textContent(t) { this._text = String(t); this.children = [] }
  get textContent() { return this._text ?? this.children.map((c) => c.textContent).join(' ') }
  // innerHTML must never be used: make any use of it fail loudly.
  set innerHTML(_) { throw new Error('innerHTML used') }
  append(...nodes) { this.children.push(...nodes) }
  replaceChildren(...nodes) { this.children = nodes; this._text = null }
  addEventListener(type, fn) { this.listeners[type] = fn }
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const f = c.find?.(pred); if (f) return f } return null }
  findAll(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.findAll?.(pred, out); return out }
}
const fakeDoc = { createElement: (tag) => new FakeNode(tag) }
const byClass = (name) => (n) => n.className === name
const settle = () => new Promise((r) => setTimeout(r, 0))

// ---- pure helpers ----

test('stationsGeoJSON: [lon, lat] order, id/name properties, home left out', () => {
  const fc = stationsGeoJSON(STATIONS, 'NYP')
  assert.equal(fc.type, 'FeatureCollection')
  assert.deepEqual(fc.features.map((f) => f.properties.id), ['PHL', 'X1'])
  assert.deepEqual(fc.features[0].geometry, { type: 'Point', coordinates: [-75.18, 39.96] })
})

test('homeGeoJSON: just the home station, or nothing if it is not on the map', () => {
  assert.deepEqual(homeGeoJSON(STATIONS, 'NYP').features.map((f) => f.properties.id), ['NYP'])
  assert.equal(homeGeoJSON(STATIONS, 'ZZZ').features.length, 0)
})

test('the CDN version is pinned exactly, and index.html loads the same version of the CSS', () => {
  assert.match(MAPLIBRE_URL, /maplibre-gl@\d+\.\d+\.\d+\/dist\/maplibre-gl\.mjs$/)
  const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8')
  assert.ok(html.includes(MAPLIBRE_CSS), 'index.html must load the CSS for the same MapLibre version')
  assert.equal(STYLE_URL, 'https://tiles.openfreemap.org/styles/positron')
})

test('previewModel: trains today, fastest, first – last, up to 3 routes', () => {
  assert.deepEqual(previewModel(PHL_SUMMARY), {
    from: 'New York Penn Station',
    stats: [['41', 'trains today'], ['1h 08m', 'fastest'], ['12:20 AM – 11:23 PM', 'first – last (ET)']],
    routes: ['Northeast Regional', 'Acela', 'Keystone Service'],
    moreRoutes: 2,
  })
  assert.equal(previewModel({ ...PHL_SUMMARY, trainsPerDay: 1 }).stats[0][1], 'train today')
})

test('previewModel: no trains, outside the feed, or no match become one status line', () => {
  assert.deepEqual(previewModel({ ...PHL_SUMMARY, trainsPerDay: 0 }), { status: 'No direct train from New York Penn Station today.' })
  assert.deepEqual(previewModel({ ...PHL_SUMMARY, outsideFeed: true }), { status: 'No schedule data for 2026-10-28.' })
  assert.deepEqual(previewModel({ ok: false, notes: ['No station matches to "ZZZ".'] }), { status: 'No station matches to "ZZZ".' })
  assert.deepEqual(previewModel(null), { status: 'No schedule data for this station.' })
})

test('buildPreview: text only, hostile route names stay text', () => {
  const box = buildPreview(fakeDoc, previewModel({ ...PHL_SUMMARY, routes: [EVIL] }))
  assert.match(box.textContent, /41 trains today/)
  assert.equal(box.find(byClass('map-preview-routes')).textContent, EVIL, 'kept as literal text')
})

// ---- a fake MapLibre ----
function fakeLibrary({ leaves = [] } = {}) {
  const log = { layers: [], sources: {}, handlers: {}, popups: [], controls: 0, options: null }
  class FakeMap {
    constructor(options) { log.options = options }
    addControl() { log.controls++ }
    once(event, fn) { if (event === 'load') queueMicrotask(fn) }
    off() {}
    isStyleLoaded() { return true }
    addSource(id, def) {
      log.sources[id] = {
        ...def, setData(d) { this.data = d },
        getClusterExpansionZoom: async () => 9,
        getClusterLeaves: async (clusterId, limit) => { log.leavesAsked = { clusterId, limit }; return leaves.slice(0, limit) },
      }
    }
    getSource(id) { return log.sources[id] }
    addLayer(layer) { log.layers.push(layer) }
    on(event, layer, fn) { if (fn) log.handlers[`${event}:${layer}`] = fn; else log.handlers[event] = layer }
    easeTo(opts) { log.eased = opts }
    getCanvas() { return { style: {} } }
    // What is "under the finger" is set by each test (log.under).
    queryRenderedFeatures(point, options) { log.queried = options; return log.under ?? [] }
    project([lon, lat]) { return { x: lon * 100, y: -lat * 100 } }
  }
  class FakePopup {
    constructor(options) { this.entry = { options, removed: false }; log.popups.push(this.entry) }
    setLngLat(c) { this.entry.at = c; return this }
    setText(t) { this.entry.text = t; return this }
    setHTML(h) { this.entry.html = h; return this }
    setDOMContent(node) { this.entry.node = node; return this }
    addTo() { return this }
    remove() { this.entry.removed = true }
  }
  class FakeNav {}
  return { log, lib: { Map: FakeMap, Popup: FakePopup, NavigationControl: FakeNav } }
}

// initMap reads colour tokens from the page; give node a minimal stand-in.
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' })
globalThis.document ??= { documentElement: {} }

async function start({ homeId = 'NYP', leaves, loadPreview } = {}) {
  const { log, lib } = fakeLibrary({ leaves })
  const opened = []
  const asked = []
  const ctl = await initMap('el', {
    homeId,
    doc: fakeDoc,
    loadLibrary: async () => lib,
    fetchStations: async () => STATIONS,
    loadPreview: loadPreview ?? (async (id) => { asked.push(id); return PHL_SUMMARY }),
    onOpen: (id, name) => opened.push({ id, name }),
  })
  return { log, opened, asked, ctl }
}
const stationFeature = (s) => ({ properties: { id: s.id, name: s.name }, geometry: { coordinates: [s.lon, s.lat] } })
const clusterFeature = (count) => ({ properties: { cluster_id: 7, point_count: count }, geometry: { coordinates: [-75, 40] } })
const leaf = (s) => ({ properties: { id: s.id, name: s.name } })
// A tap: `features` are what MapLibre reports under the finger; by default the
// finger lands exactly on the first one (fake project: x = lon*100, y = -lat*100).
const tap = (log, features, point) => {
  log.under = features
  const [lon, lat] = features[0].geometry.coordinates
  return log.handlers.click({ point: point ?? { x: lon * 100, y: -lat * 100 } })
}

test('initMap: OpenFreeMap style, clustered stations, a separate home layer', async () => {
  const { log, ctl } = await start()
  assert.equal(log.options.style, STYLE_URL)
  assert.equal(log.sources.stations.cluster, true)
  assert.deepEqual(log.layers.map((l) => l.id), ['clusters', 'cluster-count', 'station', 'home', 'station-hit', 'home-hit'])
  assert.deepEqual(log.layers.find((l) => l.id === 'cluster-count').layout['text-font'], ['Noto Sans Bold'])
  assert.equal(log.sources.home.data.features[0].properties.id, 'NYP')
  assert.equal(ctl.stationCount, 3)
})

test('tapping a station: popup with name + preview from the home station, no HTML', async () => {
  const { log, opened, asked } = await start()
  tap(log, [stationFeature(STATIONS[1])])
  await settle()
  const popup = log.popups[0]
  assert.equal(popup.html, undefined, 'setHTML must never be used')
  assert.equal(popup.text, undefined)
  assert.equal(popup.node.find(byClass('map-pop-title')).textContent, 'Philadelphia 30th Street')
  assert.match(popup.node.textContent, /41 trains today/)
  assert.match(popup.node.textContent, /1h 08m fastest/)
  assert.deepEqual(asked, ['PHL'])
  assert.deepEqual(opened, [{ id: 'PHL', name: 'Philadelphia 30th Street' }])
})

test('a hostile station name shows as text in the popup', async () => {
  const { log } = await start()
  tap(log, [stationFeature(STATIONS[2])])
  await settle()
  assert.equal(log.popups[0].node.find(byClass('map-pop-title')).textContent, EVIL)
})

test('previews are fetched once per station, and a failure shows a message and can retry', async () => {
  let calls = 0
  const { log } = await start({ loadPreview: async () => { calls++; if (calls === 1) throw new Error('Lookup failed (500)'); return PHL_SUMMARY } })
  tap(log, [stationFeature(STATIONS[1])])
  await settle()
  assert.match(log.popups[0].node.textContent, /Couldn't load trains \(Lookup failed \(500\)\)/)
  tap(log, [stationFeature(STATIONS[1])])
  await settle()
  assert.match(log.popups[1].node.textContent, /41 trains today/, 'retried after the failure')
  tap(log, [stationFeature(STATIONS[1])])
  await settle()
  assert.equal(calls, 2, 'the successful preview is reused, not refetched')
  assert.equal(log.popups[0].removed && log.popups[1].removed, true, 'one popup at a time')
})

test('tapping a cluster lists its stations A–Z as dropdowns; nothing loads until one is opened', async () => {
  const { log, asked, opened } = await start({ leaves: [leaf(STATIONS[1]), leaf(STATIONS[2])] })
  await tap(log, [clusterFeature(2)])
  const node = log.popups[0].node
  assert.equal(node.find(byClass('map-pop-title')).textContent, '2 stations')
  const items = node.findAll(byClass('map-cluster-item'))
  assert.deepEqual(items.map((i) => i.children[0].textContent), [EVIL, 'Philadelphia 30th Street'], 'sorted by name, as text')
  assert.equal(items[0].children[0].tag, 'summary')
  assert.deepEqual(asked, [], 'no preview fetched yet')
  assert.equal(log.leavesAsked.limit, CLUSTER_LIST_LIMIT)

  // Open Philadelphia's dropdown.
  items[1].open = true
  items[1].listeners.toggle()
  await settle()
  assert.match(items[1].children[1].textContent, /41 trains today/)
  assert.deepEqual(asked, ['PHL'])
  assert.deepEqual(opened, [{ id: 'PHL', name: 'Philadelphia 30th Street' }])
  // Closing and reopening does not fetch or log again.
  items[1].open = false; items[1].listeners.toggle()
  items[1].open = true; items[1].listeners.toggle()
  await settle()
  assert.deepEqual(asked, ['PHL'])
})

test('a big cluster says how many more, and Zoom in zooms and closes the popup', async () => {
  const { log } = await start({ leaves: [leaf(STATIONS[1])] })
  await tap(log, [clusterFeature(60)])
  const node = log.popups[0].node
  assert.match(node.textContent, /\+59 more\. Zoom in to see them\./)
  await node.find(byClass('map-zoom-in')).listeners.click()
  assert.deepEqual(log.eased, { center: [-75, 40], zoom: 9 })
  assert.equal(log.popups[0].removed, true)
})

test('setHome moves the highlight, closes the open popup, and refetches previews from the new home', async () => {
  const asked = []
  const { log, ctl } = await start({ loadPreview: async (id) => { asked.push(id); return PHL_SUMMARY } })
  tap(log, [stationFeature(STATIONS[1])])
  await settle()
  ctl.setHome('PHL')
  assert.equal(log.sources.home.data.features[0].properties.id, 'PHL')
  assert.ok(log.sources.stations.data.features.some((f) => f.properties.id === 'NYP'), 'old home goes back to a normal pin')
  assert.equal(log.popups[0].removed, true)
  tap(log, [stationFeature(STATIONS[0])])
  tap(log, [stationFeature(STATIONS[1])])
  await settle()
  assert.deepEqual(asked, ['PHL', 'NYP', 'PHL'], 'a new home means new numbers, so no stale cache')
})

test('initMap rejects (so the page can show its error) when stations fail to load', async () => {
  const { lib } = fakeLibrary()
  await assert.rejects(
    initMap('el', { homeId: 'NYP', doc: fakeDoc, loadLibrary: async () => lib, fetchStations: async () => { throw new Error('Stations failed (500)') }, loadPreview: async () => ({}) }),
    /Stations failed/,
  )
})

test('popups open on a fixed side and the map slides so they fit (previews above, lists below)', async () => {
  const { log } = await start({ leaves: [leaf(STATIONS[1])] })
  tap(log, [stationFeature(STATIONS[1])])
  assert.equal(log.popups[0].options.anchor, 'bottom', 'station preview sits above the pin')
  assert.deepEqual(log.eased, { center: [-75.18, 39.96], offset: [0, 96] }, 'pin moved below centre')
  await tap(log, [clusterFeature(1)])
  assert.equal(log.popups[1].options.anchor, 'top', 'cluster list hangs below the point')
  assert.deepEqual(log.eased, { center: [-75, 40], offset: [0, -122] }, 'point moved above centre')
})

test('nearestFeature: the closest centre to the tap wins; nothing under the finger is null', () => {
  const project = ([x, y]) => ({ x, y })
  const a = { geometry: { coordinates: [0, 0] } }
  const b = { geometry: { coordinates: [30, 0] } }
  assert.equal(nearestFeature([a, b], { x: 10, y: 0 }, project), a)
  assert.equal(nearestFeature([a, b], { x: 20, y: 0 }, project), b)
  assert.equal(nearestFeature([], { x: 0, y: 0 }, project), null)
})

test('pins have an invisible 22 px tap circle (44 px across); taps query it, not the 5 px dot', async () => {
  const { log } = await start()
  assert.equal(TAP_RADIUS, 22)
  for (const id of ['station-hit', 'home-hit']) {
    const layer = log.layers.find((l) => l.id === id)
    assert.equal(layer.paint['circle-radius'], TAP_RADIUS, id)
    assert.equal(layer.paint['circle-opacity'], 0, `${id} must be invisible`)
  }
  tap(log, [stationFeature(STATIONS[1])])
  assert.deepEqual(log.queried.layers, ['clusters', 'station-hit', 'home-hit'])
})

test('a near miss still opens the pin; with two tap circles overlapping, the closer pin opens', async () => {
  const { log } = await start()
  const phl = stationFeature(STATIONS[1]) // screen (-7518, -3996)
  const x1 = stationFeature(STATIONS[2])  // screen (-7400, -4100)
  // Finger 15 px off Philadelphia: still Philadelphia.
  tap(log, [phl], { x: -7518 + 15, y: -3996 })
  await settle()
  assert.equal(log.popups.at(-1).node.find(byClass('map-pop-title')).textContent, 'Philadelphia 30th Street')
  // Both circles under the finger, which is closer to X1: X1 opens.
  tap(log, [phl, x1], { x: -7410, y: -4090 })
  await settle()
  assert.equal(log.popups.at(-1).node.find(byClass('map-pop-title')).textContent, EVIL)
})

test('a tap on empty map does nothing', async () => {
  const { log } = await start()
  log.under = []
  log.handlers.click({ point: { x: 0, y: 0 } })
  assert.equal(log.popups.length, 0)
})
