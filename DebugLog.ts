type LogEntry = { time: string; message: string };

const MAX_LOGS = 500;
let buffer: LogEntry[] = [];

export function logDebug(message: string) {
  const time = new Date().toISOString().split('T')[1]?.replace('Z', '') ?? '';
  buffer.push({ time, message });
  if (buffer.length > MAX_LOGS) {
    buffer.shift();
  }
}

export function getDebugLogs(): string {
  if (buffer.length === 0) return 'No logs yet.';
  return buffer.map(l => `[${l.time}] ${l.message}`).join('\n');
}

export function clearDebugLogs() {
  buffer = [];
}