export type LyricLine = { startMs: number; endMs: number; text: string };

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/**
 * Parses LRC synced lyrics (`[mm:ss.xx] text`) into timed lines.
 *
 * A line may carry several timestamps (a repeated chorus); each becomes its
 * own line. Lines end where the next one begins and the last one ends at the
 * song's end. Metadata tags such as `[ar:...]` are ignored, and empty lines are
 * kept as gaps so an instrumental break clears the lyric on screen.
 */
export function parseLrc(source: string, songDurationMs: number): LyricLine[] {
  const starts: Array<{ startMs: number; text: string }> = [];
  for (const raw of source.split(/\r?\n/)) {
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    TIMESTAMP.lastIndex = 0;
    let lastIndex = 0;
    while ((match = TIMESTAMP.exec(raw)) && match.index === lastIndex) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ?? '0';
      const millis = Number(fraction.padEnd(3, '0').slice(0, 3));
      stamps.push(minutes * 60_000 + seconds * 1000 + millis);
      lastIndex = TIMESTAMP.lastIndex;
    }
    if (!stamps.length) continue;
    const text = raw.slice(lastIndex).trim();
    for (const startMs of stamps) starts.push({ startMs, text });
  }
  starts.sort((first, second) => first.startMs - second.startMs);
  const end = Math.max(songDurationMs, starts[starts.length - 1]?.startMs ?? 0);
  return starts.map((line, index) => ({
    startMs: line.startMs,
    endMs: index + 1 < starts.length ? starts[index + 1].startMs : end,
    text: line.text,
  }));
}

/** Removes the parts of a title that stop lyric databases from matching it. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([]\s*(from|feat\.?|ft\.?|with)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(remix|reprise|unplugged|lofi|lo-fi|slowed|reverb|version|edit)\b.*$/i, '')
    .replace(/\s+(feat\.?|ft\.?)\s+.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
