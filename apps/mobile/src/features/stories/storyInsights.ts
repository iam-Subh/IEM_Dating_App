import { api } from '../../services/api';
import { uuid } from './create/composition/story';

/**
 * A viewer's navigation events, accumulated locally and sent as one batch
 * (STORY_ARCHIVE_SPEC.md, section 7.4) - never a request per tap. Exactly
 * which gesture maps to which event is section 7.3:
 *
 *   tap right (incl. past the last story)  -> forward
 *   tap left (incl. before the first story) -> back
 *   swipe to the next person                -> nextStory
 *   swipe to the previous person             -> exited
 *   close, swipe down, back, app backgrounded, or the tray runs out -> exited
 *   the timer or video finishing by itself   -> nothing
 *
 * A single instance is created per viewer session (`StoryViewerScreen`), kept
 * in a ref so a tap never causes a re-render.
 */
export type StoryInsightCounters = { views: number; forward: number; back: number; nextStory: number; exited: number };

const empty = (): StoryInsightCounters => ({ views: 0, forward: 0, back: 0, nextStory: 0, exited: 0 });

export class StoryInsightTracker {
  private readonly demo: boolean;
  private counts = new Map<string, StoryInsightCounters>();

  constructor(demo: boolean) {
    this.demo = demo;
  }

  private cell(storyId: string): StoryInsightCounters {
    let entry = this.counts.get(storyId);
    if (!entry) {
      entry = empty();
      this.counts.set(storyId, entry);
    }
    return entry;
  }

  view(storyId: string) { if (!this.demo) this.cell(storyId).views += 1; }
  forward(storyId: string) { if (!this.demo) this.cell(storyId).forward += 1; }
  back(storyId: string) { if (!this.demo) this.cell(storyId).back += 1; }
  nextStory(storyId: string) { if (!this.demo) this.cell(storyId).nextStory += 1; }
  exited(storyId: string) { if (!this.demo) this.cell(storyId).exited += 1; }

  /** True while there is anything worth sending. */
  get hasPending(): boolean {
    for (const counters of this.counts.values()) {
      if (Object.values(counters).some((value) => value > 0)) return true;
    }
    return false;
  }

  /** Sends everything accumulated so far. Failed events are merged back in for the next flush. */
  async flush(): Promise<void> {
    if (this.demo || !this.counts.size) return;
    const events = [...this.counts.entries()]
      .filter(([, counters]) => Object.values(counters).some((value) => value > 0))
      .map(([storyId, counters]) => ({ storyId, ...counters }));
    this.counts.clear();
    if (!events.length) return;
    try {
      await api.post('/stories/insights/events', { batchId: uuid(), events });
    } catch {
      // Best effort (section 7.4): merge back in so the next flush retries.
      // A batch that never gets another chance (the app is killed) is simply lost.
      for (const event of events) {
        const target = this.cell(event.storyId);
        target.views += event.views;
        target.forward += event.forward;
        target.back += event.back;
        target.nextStory += event.nextStory;
        target.exited += event.exited;
      }
    }
  }
}
