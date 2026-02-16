let lastSeenAt: string | null = null;

export function writeHeartbeatMemory() {
  lastSeenAt = new Date().toISOString();
}

export function readHeartbeatMemory() {
  return lastSeenAt;
}
