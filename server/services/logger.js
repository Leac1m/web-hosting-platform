export function logEvent(event, data = {}) {
  console.info(JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...data
  }))
}

export function logError(event, error, data = {}) {
  console.error(JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    error: error?.message || "Unknown error",
    ...data
  }))
}
