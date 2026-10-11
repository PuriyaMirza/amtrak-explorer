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
      select
        s.stop_id,
        s.stop_name,
        s.stop_timezone,
        coalesce(
          (
            select array_agg(distinct r.route_long_name order by r.route_long_name)
            from stop_times st
            join trips t on t.trip_id = st.trip_id
            join routes r on r.route_id = t.route_id
            where st.stop_id = s.stop_id
          ),
          '{}'
        ) as routes
      from stops s
      where s.stop_name ilike ${pattern}
      order by s.stop_name
      limit ${limit}
    `,
    sql`
      select
        r.route_id,
        r.route_long_name,
        r.route_type,
        coalesce(
          (
            select array_agg(distinct s.stop_name order by s.stop_name)
            from trips t
            join stop_times st on st.trip_id = t.trip_id
            join stops s on s.stop_id = st.stop_id
            where t.route_id = r.route_id
          ),
          '{}'
        ) as stops
      from routes r
      where r.route_long_name ilike ${pattern}
      order by r.route_long_name
      limit ${limit}
    `,
  ])

  return { stations, routes }
}
