// Single source of truth for search.
//
// Takes a Neon `sql` client as its first argument rather than importing one,
// so the same function works from any caller that can supply a client.
export async function searchTrains(sql, { query, limit = 20 }) {
  const pattern = `%${query}%`

  // Both queries run at once — they hit different tables and neither
  // depends on the other.
  const [stations, routes] = await Promise.all([
    sql`
      select stop_id, stop_name, stop_timezone
      from stops
      where stop_name ilike ${pattern}
      order by stop_name
      limit ${limit}
    `,
    sql`
      select route_id, route_long_name, route_type
      from routes
      where route_long_name ilike ${pattern}
      order by route_long_name
      limit ${limit}
    `,
  ])

  return { stations, routes }
}
