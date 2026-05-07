export function activityCardShouldOpen({ running, hasProcess }) {
  return Boolean(running && hasProcess);
}
