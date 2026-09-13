import { supabase } from './supabaseClient.js'

export async function searchTrains({ query, limit = 20 }) {
  const pattern = `%${query}%`

  const [stopsRes, routesRes] = await Promise.all([
    supabase
      .from('stops')
      .select('stop_id, stop_name, stop_timezone')
      .ilike('stop_name', pattern)
      .order('stop_name')
      .limit(limit),
    supabase
      .from('routes')
      .select('route_id, route_long_name, route_type')
      .ilike('route_long_name', pattern)
      .order('route_long_name')
      .limit(limit),
  ])

  if (stopsRes.error) throw stopsRes.error
  if (routesRes.error) throw routesRes.error

  return { stations: stopsRes.data, routes: routesRes.data }
}