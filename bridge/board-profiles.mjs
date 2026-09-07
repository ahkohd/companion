import waveshare from '../shared/boards/waveshare-1.75-b.json' with { type: 'json' };

// Registration is explicit: a USB serial device is not necessarily Companion firmware.
export const boardProfiles = [waveshare];
export function profileForReady(message) {
  if (message?.type !== 'ready') return null;
  const profile = boardProfiles.find(item => item.id === message.board && item.protocol === message.v);
  if (!profile) return null;
  // The original tested firmware did not report geometry. Keep that version working.
  if (message.display === undefined) return profile.id === 'waveshare-1.75-b' ? structuredClone(profile) : null;
  const display = message.display;
  if (!display || display.width !== profile.display.width || display.height !== profile.display.height || display.shape !== profile.display.shape) return null;
  return structuredClone(profile);
}
