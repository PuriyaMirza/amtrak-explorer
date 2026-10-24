// The home station: where a question starts when the person doesn't say.
// Shared by the browser (the "Your station" picker in index.html) and the
// server (ask-core.js uses DEFAULT_HOME_STATION). Pure: storage is passed in,
// so the tests can use a fake one.
//
// What is stored is only a convenience for the label. The server ignores the
// name and checks the stop_id against the `stops` table (resolveHomeStation),
// so editing localStorage by hand can't change what the model is told.

// The name is ours, not the feed's ("Ny Moynihan Train Hall At Penn
// Station"), because it is what people see and what the model repeats.
export const DEFAULT_HOME_STATION = { stop_id: 'NYP', name: 'New York Penn Station' }

export const STORAGE_KEY = 'amtrak_home_station'

// Our names for stations whose feed name is unclear. "Boston" is the feed's
// name for THREE stations, so without these the picker shows three
// identical rows. Used by the picker and by the server's prompt.
export const STATION_NAMES = {
  NYP: DEFAULT_HOME_STATION.name,
  BOS: 'Boston South Station',
  BBY: 'Boston Back Bay',
  BON: 'Boston North Station',
}

// The name to show for a station: ours if we have one, else the feed's.
export function stationName(stopId, feedName) {
  return Object.hasOwn(STATION_NAMES, stopId) ? STATION_NAMES[stopId] : feedName
}

const STOP_ID_PATTERN = /^[A-Za-z0-9]{1,10}$/

// A station from an /api/search row ({ stop_id, stop_name, ... }).
export function stationFromSearchRow(row) {
  if (row.stop_id === DEFAULT_HOME_STATION.stop_id) return DEFAULT_HOME_STATION
  return { stop_id: row.stop_id, name: stationName(row.stop_id, row.stop_name) }
}

function isStation(value) {
  return (
    typeof value?.stop_id === 'string' && STOP_ID_PATTERN.test(value.stop_id) &&
    typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 100
  )
}

// The saved station, or the default if nothing (or something malformed) is
// saved. Storage can throw (private mode, blocked cookies), so it's guarded.
export function loadHomeStation(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    return isStation(saved) ? { stop_id: saved.stop_id, name: saved.name } : DEFAULT_HOME_STATION
  } catch {
    return DEFAULT_HOME_STATION
  }
}

// Saves a station. Returns what is now in effect: the station, or the
// default if it was malformed. A storage failure only means it won't be
// remembered next visit.
export function saveHomeStation(storage, station) {
  if (!isStation(station)) return DEFAULT_HOME_STATION
  const clean = { stop_id: station.stop_id, name: station.name }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // ignore
  }
  return clean
}
