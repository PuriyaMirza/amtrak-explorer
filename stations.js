// listStations(): every station that a TRAIN serves, with its position, for
// the map (PRD §7 "Map", MapLibre + OpenFreeMap). Plain data, no AI in the path.
//
// Like search.js, it takes the `sql` client as a parameter (dependency
// injection), so api/stations.js and the tests share one implementation.
import { stationName } from './home-station.js'

// One fixed query, no parameters from the request at all.
//   - only stops that some route_type 2 (train) trip stops at: bus-only Thruway
//     stops are left out, so a pin never opens an empty "no trains" header
//   - length(stop_name) > 5 drops the truncated junk names ("Lbo", "Old"; see
//     CLAUDE.md "Real data-quality findings")
//   - stops without coordinates can't be drawn, so they are skipped
export async function listStations(sql) {
  const rows = await sql`
    select s.stop_id, s.stop_name, s.stop_lat, s.stop_lon
    from stops s
    where s.stop_lat is not null and s.stop_lon is not null
      and length(s.stop_name) > 5
      and exists (
        select 1 from stop_times st
        join trips t on t.trip_id = st.trip_id
        join routes r on r.route_id = t.route_id
        where st.stop_id = s.stop_id and r.route_type = 2
      )
    order by s.stop_name, s.stop_id`
  return rows
    .map((r) => ({
      id: r.stop_id,
      // Our display names ("New York Penn Station", not the feed's Moynihan
      // name), the same ones the picker, the ask box and the B3 header use.
      name: stationName(r.stop_id, r.stop_name),
      lat: Number(r.stop_lat),
      lon: Number(r.stop_lon),
    }))
    // Coordinates may come back as text; anything that isn't a real
    // latitude/longitude would put a pin in the wrong place, so drop it.
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) &&
      Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180 && !(s.lat === 0 && s.lon === 0))
}
