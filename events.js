// Usage logging. Fire-and-forget: if a log fails, the user never knows
// and nothing else is affected.

function getOrCreate(storage, key) {
  let value = storage.getItem(key)
  if (!value) {
    value = crypto.randomUUID()
    storage.setItem(key, value)
  }
  return value
}

// device_id lives in localStorage, so it survives closing the tab — it
// identifies this browser. session_id lives in sessionStorage, which clears
// when the tab closes — it identifies one visit.
const deviceId = getOrCreate(localStorage, 'amtrak_device_id')
const sessionId = getOrCreate(sessionStorage, 'amtrak_session_id')

export async function logEvent(eventType, fields = {}) {
  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: eventType,
        device_id: deviceId,
        session_id: sessionId,
        ...fields,
      }),
    })
  } catch (err) {
    console.warn('logEvent failed silently:', err)
  }
}
