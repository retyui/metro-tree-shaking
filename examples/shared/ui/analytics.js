export function track(event) {
  console.log('PROBE_UNUSED_analytics_track', event);
}

export function identify(user) {
  console.log('PROBE_UNUSED_analytics_identify', user);
}
