// map.js: the GeoJSON conversion, and initMap() against a FAKE MapLibre (no
// browser, no network). The fake records what the page asks the library to do,
// so we can check the wiring: layers, clicks, and that names go in as TEXT.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stationsGeoJSON, homeGeoJSON, initMap, MAPLIBRE_URL, MAPLIBRE_CSS, STYLE_URL } from '../map.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const STATIONS = [
  { id: 'NYP', name: 'New York Penn Station', lat: 40.75, lon: -73.99 },
  { id: 'PHL', name: 'Philadelphia 30th Street', lat: 39.96, lon: -75.18 },
  { id: 'X1', name: '<img src=x onerror=alert(1)>', lat: 41, lon: -74 },
]

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

// ---- a fake MapLibre ----
function fakeLibrary() {
  const log = { layers: [], sources: {}, handlers: {}, popups: [], controls: 0, options: null }
  class FakeMap {
    constructor(options) { log.options = options; this.listeners = {} }
    addControl() { log.controls++ }
    once(event, fn) { if (event === 'load') queueMicrotask(fn) }
    off() {}
    isStyleLoaded() { return true }
    addSource(id, def) { log.sources[id] = { ...def, setData(d) { this.data = d }, getClusterExpansionZoom: async () => 9 } }
    getSource(id) { return log.sources[id] }
    addLayer(layer) { log.layers.push(layer) }
    on(event, layer, fn) { if (fn) log.handlers[`${event}:${layer}`] = fn; else log.handlers[event] = layer }
    easeTo(opts) { log.eased = opts }
    getCanvas() { return { style: {} } }
  }
  class FakePopup {
    constructor() { this.entry = {}; log.popups.push(this.entry) }
    setLngLat(c) { this.entry.at = c; return this }
    setText(t) { this.entry.text = t; return this }
    setHTML(h) { this.entry.html = h; return this }
    addTo() { return this }
  }
  class FakeNav {}
  return { log, lib: { Map: FakeMap, Popup: FakePopup, NavigationControl: FakeNav } }
}

// initMap reads colour tokens from the page; give node a minimal stand-in.
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' })
globalThis.document ??= { documentElement: {} }

async function start(homeId = 'NYP') {
  const { log, lib } = fakeLibrary()
  const picks = []
  const ctl = await initMap('el', {
    homeId,
    loadLibrary: async () => lib,
    fetchStations: async () => STATIONS,
    onPick: (id, name) => picks.push({ id, name }),
  })
  return { log, picks, ctl }
}

test('initMap: OpenFreeMap style, clustered stations, a separate home layer', async () => {
  const { log, ctl } = await start()
  assert.equal(log.options.style, STYLE_URL)
  assert.equal(log.sources.stations.cluster, true)
  assert.deepEqual(log.layers.map((l) => l.id), ['clusters', 'cluster-count', 'station', 'home'])
  assert.deepEqual(log.layers.find((l) => l.id === 'cluster-count').layout['text-font'], ['Noto Sans Bold'])
  assert.equal(log.sources.home.data.features[0].properties.id, 'NYP')
  assert.equal(ctl.stationCount, 3)
})

test('clicking a station calls onPick and shows the name as TEXT, never HTML', async () => {
  const { log, picks } = await start()
  const evil = STATIONS[2]
  log.handlers['click:station']({ features: [{ properties: { id: evil.id, name: evil.name }, geometry: { coordinates: [evil.lon, evil.lat] } }] })
  assert.deepEqual(picks, [{ id: 'X1', name: evil.name }])
  assert.equal(log.popups[0].text, evil.name)
  assert.equal(log.popups[0].html, undefined, 'setHTML must never be used')
})

test('clicking a cluster zooms in to split it', async () => {
  const { log } = await start()
  await log.handlers['click:clusters']({ features: [{ properties: { cluster_id: 7 }, geometry: { coordinates: [-75, 40] } }] })
  assert.deepEqual(log.eased, { center: [-75, 40], zoom: 9 })
})

test('setHome moves the highlight when the picker changes', async () => {
  const { log, ctl } = await start('NYP')
  ctl.setHome('PHL')
  assert.equal(log.sources.home.data.features[0].properties.id, 'PHL')
  assert.ok(log.sources.stations.data.features.some((f) => f.properties.id === 'NYP'), 'old home goes back to a normal pin')
})

test('initMap rejects (so the page can show its error) when stations fail to load', async () => {
  const { lib } = fakeLibrary()
  await assert.rejects(
    initMap('el', { homeId: 'NYP', loadLibrary: async () => lib, fetchStations: async () => { throw new Error('Stations failed (500)') }, onPick() {} }),
    /Stations failed/,
  )
})
