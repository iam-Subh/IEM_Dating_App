import { Prisma } from '@prisma/client';
import {
  LOCATION_ERASE_DAYS,
  MAX_SAVED_PLACES,
  sameCell,
} from '@iem-dating/shared/location';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { Coords, haversineKm, snapToGrid } from '../utils/geo';
import { hasFreshLocation, staleCutoff } from './eligibility.service';
import { RecommendationService } from './recommendation.service';
import { bumpMapEpoch } from './map.service';

/**
 * Where someone is, for distance discovery (LOCATION_SPEC.md).
 *
 * The threat this is written against is a classmate with a verified account
 * using the radius filter as an oracle: place a spoofed location, set the
 * smallest radius, see whether the victim appears, repeat. Grid snapping
 * bounds how precise that can get; the checks here bound how *fast* and how
 * *often* it can be tried, and leave a record when someone tries (6.3).
 *
 * Three positions are kept, and the difference matters:
 * - the **displayed** cell (`latitude`/`longitude`) is what discovery uses;
 * - the **live** cell (`liveLatitude`/`liveLongitude`) is where the phone last
 *   was, and is only the speed check's baseline - using a saved place must not
 *   move it, or switching back to live would look like a teleport;
 * - **saved places** are cells the person stood in and labelled (section 7).
 *
 * The events written here never contain coordinates. They record that a
 * change happened, which is what the budget and review need, and nothing a
 * leak of the events table could turn back into a location.
 */

/** Faster than any real journey between two readings; only a spoofed jump does this. */
export const MAX_PLAUSIBLE_KMH = 300;
/** Accepted moves of the displayed cell per rolling day. */
export const DAILY_CELL_CHANGES = 12;
/** Changes to how far someone looks, per rolling day. */
export const DAILY_RADIUS_CHANGES = 10;
/** A saved place is only created from a live fix at most this old. */
export const SAVE_PLACE_FIX_MINUTES = 10;
/** A saved place nobody has been back to in this long is removed. */
export const SAVED_PLACE_STALE_DAYS = 90;
/** A fix taken in college mode is kept this long, for saving a place or switching modes. */
export const COLLEGE_BASELINE_MINUTES = 60;

const DAY_MS = 24 * 60 * 60_000;
/** Below this, elapsed time is rounding noise; do not divide by it. */
const MIN_ELAPSED_HOURS = 1 / 60;

export type FixAccuracy = 'precise' | 'approximate';

const coordsOf = (latitude: Prisma.Decimal | null, longitude: Prisma.Decimal | null): Coords | null =>
  latitude !== null && longitude !== null ? { latitude: Number(latitude), longitude: Number(longitude) } : null;

export class LocationService {
  /**
   * Records a live fix from the phone.
   *
   * - A fix inside a place marked "hide me here" changes nothing anyone can
   *   see: only the private live baseline moves, so the person can keep
   *   browsing (invisibly) while nobody finds them there.
   * - While a saved place is in use, a fix only moves the live baseline and
   *   keeps the location fresh; the displayed cell stays on the place.
   * - A fix in the displayed cell keeps it fresh and costs nothing.
   * - A real move is speed-checked against the live baseline and budgeted.
   */
  static async update(userId: string, raw: Coords, fix: { accuracy?: FixAccuracy; accuracyM?: number } = {}) {
    const cell = snapToGrid(raw);
    const now = new Date();
    const [me, places] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          discoveryMode: true, latitude: true, longitude: true, locationConsentAt: true, locationSource: true,
          liveLatitude: true, liveLongitude: true, liveUpdatedAt: true,
        },
      }),
      prisma.savedPlace.findMany({ where: { userId } }),
    ]);
    const matched = places.find((place) => sameCell(coordsOf(place.latitude, place.longitude)!, cell)) ?? null;
    if (matched) {
      await prisma.savedPlace.update({ where: { id: matched.id }, data: { lastVisitedAt: now } });
    }
    const matchedPlace = matched ? { id: matched.id, label: matched.label } : null;
    const displayed = coordsOf(me.latitude, me.longitude);

    // Inside a place marked "hide me here": nothing about this fix is
    // stored, and the person is out of everyone's distance discovery until a
    // fix lands somewhere else. Keeping the previously shown cell visible
    // would leave them discoverable while the setting says they are hidden.
    if (matched?.hideHere) {
      // Only the private live baseline moves - it is never shown to anyone
      // and never finds this person for anyone. It lets them keep browsing
      // while hidden, from where they really are (asViewer).
      await prisma.user.update({
        where: { id: userId },
        data: { locationHiddenAt: now, liveLatitude: cell.latitude, liveLongitude: cell.longitude, liveUpdatedAt: now },
      });
      if (me.discoveryMode === 'distance') await RecommendationService.invalidateCache(userId);
      return { cell: null, changed: false, source: me.locationSource, matchedPlace, hiddenHere: true };
    }

    const live = coordsOf(me.liveLatitude, me.liveLongitude);
    if (live && me.liveUpdatedAt && !sameCell(live, cell)) {
      const hours = Math.max(MIN_ELAPSED_HOURS, (now.getTime() - me.liveUpdatedAt.getTime()) / 3_600_000);
      const kmh = haversineKm(live, cell) / hours;
      if (kmh > MAX_PLAUSIBLE_KMH) {
        await this.record(userId, 'location_change_refused', { reason: 'implausible_speed' });
        throw new HttpError(
          409,
          'That location is too far from your last one to be real. Try again later.',
          'LOCATION_IMPLAUSIBLE',
        );
      }
    }

    const fixFields = {
      liveLatitude: cell.latitude,
      liveLongitude: cell.longitude,
      liveUpdatedAt: now,
      locationAccuracy: fix.accuracy ?? null,
      locationAccuracyM: fix.accuracyM !== undefined ? Math.max(0, Math.round(fix.accuracyM)) : null,
      // Stamped on the first write; the client showed the consent screen first.
      locationConsentAt: me.locationConsentAt ?? now,
      // A fix outside every hidden place ends "hide me here".
      locationHiddenAt: null,
    };

    // College mode uses no location, so nothing is displayed or discoverable:
    // the fix only becomes the short-lived baseline that saving a place, or
    // switching to distance mode in the next few minutes, needs. The sweep
    // clears it within the hour if neither happens.
    if (me.discoveryMode !== 'distance') {
      await prisma.user.update({ where: { id: userId }, data: fixFields });
      return { cell: null, changed: false, source: me.locationSource, matchedPlace, hiddenHere: false };
    }

    // A saved place is in use: the phone's position only moves the baseline.
    if (me.locationSource === 'place' && displayed) {
      await prisma.user.update({ where: { id: userId }, data: { ...fixFields, locationUpdatedAt: now } });
      return { cell: displayed, changed: false, source: 'place', matchedPlace, hiddenHere: false };
    }

    // Same cell as shown: keep it fresh, spend nothing, leave the deck alone.
    if (displayed && sameCell(displayed, cell)) {
      await prisma.user.update({ where: { id: userId }, data: { ...fixFields, locationUpdatedAt: now } });
      return { cell, changed: false, source: 'live', matchedPlace, hiddenHere: false };
    }

    await this.assertCellChangeAllowed(userId);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          ...fixFields,
          latitude: cell.latitude,
          longitude: cell.longitude,
          locationUpdatedAt: now,
          locationSource: 'live',
          activePlaceId: null,
        },
      }),
      prisma.analyticsEvent.create({
        data: { userId, eventType: 'location_cell_changed', eventData: { first: !displayed, via: 'live' } },
      }),
    ]);
    // Moving changes who is nearby, so the viewer's deck is stale.
    await RecommendationService.invalidateCache(userId);
    return { cell, changed: true, source: 'live', matchedPlace, hiddenHere: false };
  }

  /** Everything the app's Location settings screen shows. */
  static async status(userId: string) {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        discoveryMode: true, latitude: true, longitude: true, locationUpdatedAt: true, locationConsentAt: true,
        locationAccuracy: true, locationAccuracyM: true, locationSource: true, activePlaceId: true,
        liveLatitude: true, liveLongitude: true, liveUpdatedAt: true,
        distancePreference: true, expandRadius: true, hideDistance: true, hideFromMaps: true,
        invisibleStart: true, invisibleEnd: true, collegeScope: true, locationHiddenAt: true,
      },
    });
    const places = await prisma.savedPlace.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const fresh = !!me.locationUpdatedAt && me.locationUpdatedAt >= staleCutoff();
    return {
      mode: me.discoveryMode,
      cell: coordsOf(me.latitude, me.longitude),
      updatedAt: me.locationUpdatedAt?.toISOString() ?? null,
      fresh,
      consented: !!me.locationConsentAt,
      accuracy: me.locationAccuracy,
      accuracyM: me.locationAccuracyM,
      source: me.locationSource,
      activePlaceId: me.activePlaceId,
      // True while the phone is in a place marked "hide me here".
      hiddenHere: !!me.locationHiddenAt,
      // Whether "Save this place" can work right now (a recent live fix).
      canSavePlace: !!me.liveUpdatedAt && Date.now() - me.liveUpdatedAt.getTime() <= SAVE_PLACE_FIX_MINUTES * 60_000,
      places: places.map((place) => ({
        id: place.id,
        label: place.label,
        hideHere: place.hideHere,
        lastVisitedAt: place.lastVisitedAt.toISOString(),
        isCurrent: !!me.liveLatitude && sameCell(coordsOf(place.latitude, place.longitude)!, coordsOf(me.liveLatitude, me.liveLongitude)!),
      })),
      settings: {
        distancePreference: me.distancePreference,
        expandRadius: me.expandRadius,
        hideDistance: me.hideDistance,
        hideFromMaps: me.hideFromMaps,
        invisibleStart: me.invisibleStart,
        invisibleEnd: me.invisibleEnd,
        collegeScope: me.collegeScope,
      },
    };
  }

  /**
   * Saves where the phone is *now* as a place (section 7). The body carries
   * only a label: the cell is the last accepted live fix, which went through
   * the speed check and budget, so a place can never be minted somewhere the
   * phone has not been.
   */
  static async savePlace(userId: string, rawLabel: string) {
    const label = cleanLabel(rawLabel);
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { liveLatitude: true, liveLongitude: true, liveUpdatedAt: true },
    });
    const live = coordsOf(me.liveLatitude, me.liveLongitude);
    if (!live || !me.liveUpdatedAt || Date.now() - me.liveUpdatedAt.getTime() > SAVE_PLACE_FIX_MINUTES * 60_000) {
      throw new HttpError(409, 'Turn on location so we can see where you are, then save this place.', 'PLACE_NEEDS_LIVE_FIX');
    }
    try {
      // Count and insert under one per-person lock, so two taps at once
      // cannot both pass the count and make a fourth place.
      const place = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`saved-places:${userId}`}, 0))`;
        const count = await tx.savedPlace.count({ where: { userId } });
        if (count >= MAX_SAVED_PLACES) {
          throw new HttpError(409, `You can save up to ${MAX_SAVED_PLACES} places. Remove one first.`, 'PLACE_LIMIT');
        }
        return tx.savedPlace.create({
          data: { userId, label, latitude: live.latitude, longitude: live.longitude },
        });
      });
      return { id: place.id, label: place.label, hideHere: place.hideHere };
    } catch (error: any) {
      if (error?.code === 'P2002') throw new HttpError(409, 'This place is already saved.', 'PLACE_ALREADY_SAVED');
      throw error;
    }
  }

  static async updatePlace(userId: string, placeId: string, change: { label?: string; hideHere?: boolean }) {
    const place = await this.ownPlace(userId, placeId);
    const updated = await prisma.savedPlace.update({
      where: { id: place.id },
      data: {
        ...(change.label !== undefined ? { label: cleanLabel(change.label) } : {}),
        ...(change.hideHere !== undefined ? { hideHere: change.hideHere } : {}),
      },
    });
    const placeCell = coordsOf(place.latitude, place.longitude)!;
    if (change.hideHere) {
      // "Hide me here" must take effect now, not at the next fix: if this is
      // the place being used, the cell currently shown, or where the phone
      // is right now, stop showing the person.
      const me = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { latitude: true, longitude: true, activePlaceId: true, liveLatitude: true, liveLongitude: true },
      });
      const displayed = coordsOf(me.latitude, me.longitude);
      const live = coordsOf(me.liveLatitude, me.liveLongitude);
      const shownHere = !!displayed && sameCell(displayed, placeCell);
      const phoneHere = !!live && sameCell(live, placeCell);
      if (me.activePlaceId === place.id || shownHere || phoneHere) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            locationSource: 'live',
            activePlaceId: null,
            ...(shownHere ? { latitude: null, longitude: null } : {}),
            ...(phoneHere ? { locationHiddenAt: new Date() } : {}),
          },
        });
        await RecommendationService.invalidateCache(userId);
      }
    } else if (change.hideHere === false && place.hideHere) {
      // Do not clear locationHiddenAt here. The last displayed cell can be a
      // different, older place because fixes inside a hidden place are not
      // stored. Clearing the flag without a fresh fix would expose that old
      // cell again. The next accepted phone fix clears the flag and publishes
      // the position that was actually measured.
    }
    return { id: updated.id, label: updated.label, hideHere: updated.hideHere };
  }

  static async deletePlace(userId: string, placeId: string) {
    const place = await this.ownPlace(userId, placeId);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { activePlaceId: true } });
    await prisma.savedPlace.delete({ where: { id: place.id } });
    // A deleted place in use stops being shown now, exactly as leaving it does.
    if (me.activePlaceId === place.id) await this.leavePlace(userId);
    // If this place caused "hide me here", remain hidden until a fresh phone
    // fix arrives. Clearing the flag here could expose an older displayed
    // cell. A fix cannot match this deleted place, so it will clear the flag.
    return { removed: true };
  }

  /**
   * Appear from a saved place instead of the phone (placeId), or go back to
   * following the phone (null). Switching is instant but spends the same daily
   * budget as moving, so saved places cannot become a probing tool (section 7).
   *
   * Going back to the phone changes the source and the coordinates together:
   * the saved place stops being shown at once, and the phone's fix (sent with
   * the switch) takes its place. Without a fix the person has no shown
   * location until the next one arrives - never the old place.
   */
  static async useSource(
    userId: string,
    placeId: string | null,
    fix?: { latitude: number; longitude: number; accuracy?: FixAccuracy; accuracyM?: number },
  ) {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { discoveryMode: true, latitude: true, longitude: true, activePlaceId: true, locationSource: true },
    });
    if (placeId === null) {
      if (me.locationSource === 'place') await this.leavePlace(userId);
      if (fix) {
        const result = await this.update(userId, fix, { accuracy: fix.accuracy, accuracyM: fix.accuracyM });
        return { source: 'live' as const, activePlaceId: null, fix: result };
      }
      return { source: 'live' as const, activePlaceId: null, fix: null };
    }
    if (me.discoveryMode !== 'distance') {
      throw new HttpError(409, 'Saved places are for distance discovery. Switch to it first.', 'DISTANCE_MODE_REQUIRED');
    }
    const place = await this.ownPlace(userId, placeId);
    if (place.hideHere) {
      throw new HttpError(409, 'You chose to be hidden at this place. Turn that off to use it.', 'PLACE_HIDDEN');
    }
    const cell = coordsOf(place.latitude, place.longitude)!;
    const displayed = coordsOf(me.latitude, me.longitude);
    const moves = !displayed || !sameCell(displayed, cell);
    if (moves) await this.assertCellChangeAllowed(userId);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          latitude: cell.latitude,
          longitude: cell.longitude,
          locationUpdatedAt: new Date(),
          locationSource: 'place',
          activePlaceId: place.id,
          locationHiddenAt: null,
        },
      }),
      ...(moves
        ? [prisma.analyticsEvent.create({
          data: { userId, eventType: 'location_cell_changed', eventData: { first: !displayed, via: 'saved_place' } },
        })]
        : []),
    ]);
    if (moves) await RecommendationService.invalidateCache(userId);
    return { source: 'place' as const, activePlaceId: place.id, fix: null };
  }

  /**
   * Stops showing a saved place: back to following the phone, with no shown
   * location until the phone sends one. The live baseline is kept for the
   * speed check.
   */
  private static async leavePlace(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { locationSource: 'live', activePlaceId: null, latitude: null, longitude: null },
    });
    await RecommendationService.invalidateCache(userId);
  }

  /** The privacy switches (sections 6.6, 9.4). */
  static async updateSettings(userId: string, change: {
    hideDistance?: boolean;
    hideFromMaps?: boolean;
    invisibleHours?: { start: number; end: number } | null;
  }) {
    const hours = change.invisibleHours;
    if (hours) {
      const valid = (value: number) => Number.isInteger(value) && value >= 0 && value <= 1439;
      if (!valid(hours.start) || !valid(hours.end) || hours.start === hours.end) {
        throw new HttpError(400, 'Choose a start and an end time that differ.', 'INVALID_INVISIBLE_HOURS');
      }
    }
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { hideFromMaps: true } });
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(change.hideDistance !== undefined ? { hideDistance: change.hideDistance } : {}),
        ...(change.hideFromMaps !== undefined ? { hideFromMaps: change.hideFromMaps } : {}),
        ...(hours !== undefined
          ? { invisibleStart: hours ? hours.start : null, invisibleEnd: hours ? hours.end : null }
          : {}),
      },
    });
    // Leaving the map takes effect on every map now, not after the snapshot.
    if (change.hideFromMaps === true && !before.hideFromMaps) await bumpMapEpoch();
    return (await this.status(userId)).settings;
  }

  /**
   * Withdrawing location consent (DPDP: as easy as giving it). Erases every
   * position this app holds for the person, including saved places.
   */
  static async erase(userId: string) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          ...ERASED_POSITION,
          locationConsentAt: null,
          preferencesConfirmedAt: null,
          eligibilityVersion: { increment: 1 },
        },
      }),
      prisma.savedPlace.deleteMany({ where: { userId } }),
    ]);
  }

  /**
   * The retention sweep (section 6.8): positions nobody has refreshed in
   * LOCATION_ERASE_DAYS are erased, and saved places nobody has been back to
   * in SAVED_PLACE_STALE_DAYS are removed. Safe to run any number of times.
   */
  static async sweep(now = new Date()) {
    const eraseBefore = new Date(now.getTime() - LOCATION_ERASE_DAYS * DAY_MS);
    const erased = await prisma.user.updateMany({
      where: {
        OR: [
          { latitude: { not: null }, OR: [{ locationUpdatedAt: null }, { locationUpdatedAt: { lt: eraseBefore } }] },
          { liveLatitude: { not: null }, OR: [{ liveUpdatedAt: null }, { liveUpdatedAt: { lt: eraseBefore } }] },
        ],
      },
      data: ERASED_POSITION,
    });
    // A college-mode baseline only exists to save a place or switch modes in
    // the next few minutes; an hour later it has no purpose left.
    const collegeBaselines = await prisma.user.updateMany({
      where: {
        OR: [{ discoveryMode: null }, { discoveryMode: { not: 'distance' } }],
        liveLatitude: { not: null },
        liveUpdatedAt: { lt: new Date(now.getTime() - COLLEGE_BASELINE_MINUTES * 60_000) },
      },
      data: { liveLatitude: null, liveLongitude: null, liveUpdatedAt: null, locationAccuracy: null, locationAccuracyM: null },
    });
    const staleBefore = new Date(now.getTime() - SAVED_PLACE_STALE_DAYS * DAY_MS);
    const stalePlaces = await prisma.savedPlace.findMany({
      where: { lastVisitedAt: { lt: staleBefore } },
      select: { id: true },
    });
    if (stalePlaces.length) {
      const ids = stalePlaces.map((place) => place.id);
      await prisma.$transaction([
        prisma.user.updateMany({ where: { activePlaceId: { in: ids } }, data: { locationSource: 'live', activePlaceId: null } }),
        prisma.savedPlace.deleteMany({ where: { id: { in: ids } } }),
      ]);
    }
    return { erasedPositions: erased.count + collegeBaselines.count, removedPlaces: stalePlaces.length };
  }

  /**
   * Called before a discovery-settings save. Only an actual change to the
   * radius counts: the app sends the radius on every save, so counting saves
   * would lock people out for editing their age range.
   */
  static async assertRadiusChangeAllowed(userId: string, current: number | null, next: number | undefined) {
    if (next === undefined || next === current) return false;
    const recent = await this.countSince(userId, 'radius_changed', Date.now() - DAY_MS);
    if (recent >= DAILY_RADIUS_CHANGES) {
      await this.record(userId, 'location_change_refused', { reason: 'radius_budget' });
      throw new HttpError(429, 'You have changed your distance a lot today. Try again tomorrow.', 'RADIUS_CHANGE_LIMIT');
    }
    return true;
  }

  static async recordRadiusChange(userId: string) {
    await this.record(userId, 'radius_changed', {});
  }

  /** Whether this person's own location is usable for distance mode right now. */
  static async hasFreshLocation(userId: string) {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return hasFreshLocation(me);
  }

  private static async assertCellChangeAllowed(userId: string) {
    const recent = await this.countSince(userId, 'location_cell_changed', Date.now() - DAY_MS);
    if (recent >= DAILY_CELL_CHANGES) {
      await this.record(userId, 'location_change_refused', { reason: 'daily_budget' });
      throw new HttpError(429, 'Your location has changed a lot today. Try again tomorrow.', 'LOCATION_CHANGE_LIMIT');
    }
  }

  private static async ownPlace(userId: string, placeId: string) {
    const place = await prisma.savedPlace.findFirst({ where: { id: placeId, userId } });
    if (!place) throw new HttpError(404, 'That place is not saved.', 'PLACE_NOT_FOUND');
    return place;
  }

  private static async countSince(userId: string, eventType: string, since: number) {
    return prisma.analyticsEvent.count({
      where: { userId, eventType, createdAt: { gte: new Date(since) } },
    });
  }

  private static async record(userId: string, eventType: string, eventData: Record<string, unknown>) {
    await prisma.analyticsEvent.create({ data: { userId, eventType, eventData: eventData as Prisma.InputJsonValue } });
  }
}

/** Every stored position, cleared together so none is left behind. */
export const ERASED_POSITION = {
  latitude: null,
  longitude: null,
  locationUpdatedAt: null,
  liveLatitude: null,
  liveLongitude: null,
  liveUpdatedAt: null,
  locationAccuracy: null,
  locationAccuracyM: null,
  locationSource: 'live',
  activePlaceId: null,
  locationHiddenAt: null,
} as const;

function cleanLabel(value: string) {
  const label = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!label) throw new HttpError(400, 'Give the place a name, like Home or Hostel.', 'PLACE_LABEL_REQUIRED');
  return label;
}
