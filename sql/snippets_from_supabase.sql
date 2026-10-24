

-- table_row_counts
select
  (select count(*) from stops) as stops,
  (select count(*) from routes) as routes,
  (select count(*) from trips) as trips,
  (select count(*) from stop_times) as stop_times,
  (select count(*) from calendar) as calendar;



-- find_trip_by_route_name
select trip_id, trip_headsign, route_id
from trips
where trip_id in (
  select t.trip_id
  from trips t
  join routes r on r.route_id = t.route_id
  where r.route_long_name ilike '%lake shore%'
)
limit 5;


-- full_itinerary_join
select
  st.stop_sequence,
  s.stop_name,
  st.arrival_time,
  st.departure_time
from stop_times st
join stops s on s.stop_id = st.stop_id
where st.trip_id = 286830
order by st.stop_sequence;


-- dwell_time_per_stop
select
  st.stop_sequence,
  s.stop_name,
  st.arrival_time,
  st.departure_time,
  st.departure_time::interval - st.arrival_time::interval as dwell_time
from stop_times st
join stops s on s.stop_id = st.stop_id
where st.trip_id = 286830
order by st.stop_sequence;


-- leg_duration_between_stops
select
  st.stop_sequence,
  s.stop_name,
  st.arrival_time,
  lag(st.departure_time) over (order by st.stop_sequence) as prev_departure,
  st.arrival_time::interval - lag(st.departure_time) over (order by st.stop_sequence)::interval as leg_duration
from stop_times st
join stops s on s.stop_id = st.stop_id
where st.trip_id = 286830
order by st.stop_sequence;


-- overnight_trip_count
select count(distinct trip_id) as overnight_trip_count
from stop_times
where arrival_time::interval >= '24:00:00'::interval
   or departure_time::interval >= '24:00:00'::interval;


-- cumulative_elapsed_time
select
  st.stop_sequence,
  s.stop_name,
  st.arrival_time,
  first_value(st.departure_time) over (order by st.stop_sequence) as origin_departure,
  st.arrival_time::interval - first_value(st.departure_time) over (order by st.stop_sequence)::interval as elapsed_time
from stop_times st
join stops s on s.stop_id = st.stop_id
where st.trip_id = 286830
order by st.stop_sequence;



-- reachable_stations_2hr_debug
with recursive edges as (
  select
    st.stop_id as from_stop,
    lead(st.stop_id) over (partition by st.trip_id order by st.stop_sequence) as to_stop,
    lead(st.arrival_time::interval) over (partition by st.trip_id order by st.stop_sequence)
      - st.departure_time::interval as duration
  from stop_times st
),
min_edges as (
  select from_stop, to_stop, min(duration) as duration
  from edges
  where to_stop is not null
  group by from_stop, to_stop
),
reachable as (
  select 'NYP'::text as stop_id, interval '0' as total_time, array['NYP']::text[] as path, 0 as hops

  union all

  select me.to_stop, r.total_time + me.duration, r.path || me.to_stop, r.hops + 1
  from reachable r
  join min_edges me on me.from_stop = r.stop_id
  where r.total_time + me.duration <= interval '2 hours'
    and not (me.to_stop = any(r.path))
    and r.hops < 4
)
select s.stop_name, min(r.total_time) as fastest_time
from reachable r
join stops s on s.stop_id = r.stop_id
group by s.stop_name
order by fastest_time;



-- reachable_stations_8hr
with recursive edges as (
  select
    st.stop_id as from_stop,
    lead(st.stop_id) over (partition by st.trip_id order by st.stop_sequence) as to_stop,
    lead(st.arrival_time::interval) over (partition by st.trip_id order by st.stop_sequence)
      - st.departure_time::interval as duration
  from stop_times st
),
min_edges as (
  select from_stop, to_stop, min(duration) as duration
  from edges
  where to_stop is not null
  group by from_stop, to_stop
),
reachable as (
  select 'NYP'::text as stop_id, interval '0' as total_time, array['NYP']::text[] as path, 0 as hops

  union all

  select me.to_stop, r.total_time + me.duration, r.path || me.to_stop, r.hops + 1
  from reachable r
  join min_edges me on me.from_stop = r.stop_id
  where r.total_time + me.duration <= interval '8 hours'
    and not (me.to_stop = any(r.path))
    and r.hops < 10
)
select s.stop_name, min(r.total_time) as fastest_time
from reachable r
join stops s on s.stop_id = r.stop_id
group by s.stop_name
order by fastest_time;



-- trips_per_weekday
select
  sum(case when c.monday = 1 then 1 else 0 end) as monday_trips,
  sum(case when c.tuesday = 1 then 1 else 0 end) as tuesday_trips,
  sum(case when c.wednesday = 1 then 1 else 0 end) as wednesday_trips,
  sum(case when c.thursday = 1 then 1 else 0 end) as thursday_trips,
  sum(case when c.friday = 1 then 1 else 0 end) as friday_trips,
  sum(case when c.saturday = 1 then 1 else 0 end) as saturday_trips,
  sum(case when c.sunday = 1 then 1 else 0 end) as sunday_trips
from trips t
join calendar c on c.service_id = t.service_id;



-- longest_legs_ranked
with min_edges as (
  select distinct
    st.trip_id,
    st.stop_id as from_stop,
    lead(st.stop_id) over (partition by st.trip_id order by st.stop_sequence) as to_stop,
    lead(st.arrival_time::interval) over (partition by st.trip_id order by st.stop_sequence)
      - st.departure_time::interval as duration
  from stop_times st
)
select
  s1.stop_name as from_station,
  s2.stop_name as to_station,
  me.duration,
  rank() over (order by me.duration desc) as duration_rank
from min_edges me
join stops s1 on s1.stop_id = me.from_stop
join stops s2 on s2.stop_id = me.to_stop
where me.to_stop is not null
  and length(s1.stop_name) > 5
  and length(s2.stop_name) > 5
order by duration_rank
limit 10;



-- events_schema_check
select column_name, data_type
from information_schema.columns
where table_name = 'events'
order by ordinal_position;


-- recent_events
select * from events order by created_at desc limit 5;