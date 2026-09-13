import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  'https://qfbruzslfbfpaylwbbtq.supabase.co',
  'sb_publishable_X8190zU7ojvk5T2dPe6eWQ_rKyceVH4'
)

function getOrCreate(storage, key) {
  let value = storage.getItem(key)
  if (!value) {
    value = crypto.randomUUID()
    storage.setItem(key, value)
  }
  return value
}

const deviceId = getOrCreate(localStorage, 'amtrak_device_id')
const sessionId = getOrCreate(sessionStorage, 'amtrak_session_id')

export async function logEvent(eventType, fields = {}) {
  try {
    await supabase.from('events').insert({
      event_type: eventType,
      device_id: deviceId,
      session_id: sessionId,
      ...fields,
    })
  } catch (err) {
    console.warn('logEvent failed silently:', err)
  }
}