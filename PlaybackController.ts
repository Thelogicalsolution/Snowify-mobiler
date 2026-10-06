// A tiny module-level bridge. service.js runs outside the React tree (it's
// registered once via TrackPlayer.registerPlaybackService and can fire
// at any time, even if no screen is mounted), so it cannot close over
// App.tsx's component state directly. App.tsx registers its current
// goNext/goPrevious here once on mount; service.js calls triggerNext/
// triggerPrevious whenever the lock screen's skip buttons are pressed.

type Handlers = {
  next: () => void;
  previous: () => void;
};

let handlers: Handlers | null = null;

export function setPlaybackHandlers(next: Handlers): void {
  handlers = next;
}

export function triggerNext(): void {
  handlers?.next();
}

export function triggerPrevious(): void {
  handlers?.previous();
}