// The machine-independent UTC rendering of a timestamp, e.g.
// "2 September, 19:44" — day without a leading zero, the full month name, a
// comma and a space, then the 24-hour clock. Locale is pinned to en-GB and
// not taken from the machine, because the interface language is fixed
// (docs/adr/0006) and the format is part of the interface. Only the time
// zone follows the reader, and that happens in the browser
// (src/public/handout.js, initLocalStamps()) — here it is always UTC, which
// is why every formatter below carries an explicit timeZone.
// hourCycle: "h23" is deliberate, not hour12: false — the latter renders
// midnight as "24:00" under some ICU builds.
const DATE_PART = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const TIME_PART = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function utcStamp(date) {
  return `${DATE_PART.format(date)}, ${TIME_PART.format(date)}`;
}
