import router from '@/router';

let lastNavAt = 0;

export function navigateTo(url) {
  const now = Date.now();
  if (now - lastNavAt < 400) return;
  lastNavAt = now;
  router.push(url);
}
