import { blueBadge } from './blue-badge';
import { ProfileNudity } from './profile-nudity.service';
import { announceOwnProfile } from './verification-live';
import { FaceVerificationService } from './face-verification.service';
import { s3ObjectUrl } from './profile-media-processing.service';
import { publicMediaHosts } from '../config/storage';
import { normalizeInterests } from "@iem-dating/shared/interest-catalog";
import { ageAt } from './eligibility.service';
import { toRadiusPreset } from '@iem-dating/shared/location';
import { LocationService } from './location.service';
import { StudentMembershipService } from './student-membership.service';
import { CampusService } from './campus.service';
import { canChooseSharedCollege } from './shared-college-choice';
import { HttpError } from '../utils/httpError';
import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { MediaCacheService } from './mediaCache.service';
import { getIO } from '../socket';
import { transformToCdnUrl } from '../middlewares/upload.middleware';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';

const PROFILE_UPDATE_SELECT = {
  id: true,
  name: true,
  birthday: true,
  age: true,
  height: true,
  gender: true,
  showGender: true,
  orientation: true,
  showOrientation: true,
  seeking: true,
  college: true,
  department: true,
  graduationYear: true,
  yearOfStudy: true,
  campus: true,
  isHosteller: true,
  clubs: true,
  hangoutSpots: true,
  distancePreference: true,
  preferences: true,
  isVerified: true,
  realPersonVerifiedAt: true,
  studentMembership: {
    select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
  },
  profileVideoUrl: true,
  videoPreviewUrl: true,
  avatarUrl: true,
  showOnlineStatus: true,
  showRecentlyActive: true,
  distanceUnit: true,
  searchDiscoverable: true,
  notifyLikes: true,
  photos: {
    select: {
      id: true,
      photoUrl: true,
      isPrimary: true,
    },
    orderBy: { order: 'asc' },
  },
} satisfies Prisma.UserSelect;
const { studentMembership: PROFILE_MEMBERSHIP_SELECT, photos: PROFILE_PHOTOS_QUERY, ...PROFILE_SCALAR_SELECT } = PROFILE_UPDATE_SELECT;

/** A valid college verification: verified, at a college still on the app, not expired. */
function collegeVerified(membership: { status: string; verifiedAt: Date | null; expiresAt: Date | null; institution: { isActive: boolean } } | null) {
  return !!(membership?.status === 'verified' && membership.verifiedAt && membership.institution.isActive &&
    (!membership.expiresAt || membership.expiresAt > new Date()));
}

export class ProfileService {
  static async getProfile(userId: string) {
    const profile = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        // The Terms version they agreed to: the app asks again when it changes (legal/documents.ts).
        termsVersion: true,
        birthday: true,
        age: true,
        gender: true,
        showGender: true,
        orientation: true,
        showOrientation: true,
        seeking: true,
        college: true,
        department: true,
        graduationYear: true,
        yearOfStudy: true,
        campus: true,
        height: true,
        degree: true,
        isHosteller: true,
        clubs: true,
        hangoutSpots: true,
        attendanceMood: true,
        distancePreference: true,
        preferences: true,
        isVerified: true,
        realPersonVerifiedAt: true,
        studentMembership: {
          select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
        },
        accountStatus: true,
        profileVideoUrl: true,
        videoPreviewUrl: true,
        avatarUrl: true,
        locationArea: true,
        lastActiveAt: true,
        showOnlineStatus: true,
        showRecentlyActive: true,
        distanceUnit: true,
        searchDiscoverable: true,
        notifyLikes: true,
        createdAt: true,
        photos: {
          select: {
            id: true,
            photoUrl: true,
            isPrimary: true,
          },
          orderBy: { order: 'asc' },
        },
      }
    });

    if (!profile) return null;

    return {
      ...profile,
      isVerified: collegeVerified(profile.studentMembership),
      blueBadge: blueBadge(collegeVerified(profile.studentMembership), profile.realPersonVerifiedAt),
      studentMembership: undefined,
      realPersonVerifiedAt: undefined,
      profileVideoUrl: profile.profileVideoUrl ? transformToCdnUrl(profile.profileVideoUrl) : null,
      videoPreviewUrl: profile.videoPreviewUrl ? transformToCdnUrl(profile.videoPreviewUrl) : null,
      avatarUrl: profile.avatarUrl ? transformToCdnUrl(profile.avatarUrl) : null,
      photos: profile.photos.map(p => ({
        ...p,
        photoUrl: transformToCdnUrl(p.photoUrl)
      })),
      // Their own photos and video waiting for the team (only ever shown to them).
      pendingMedia: await ProfileNudity.pendingFor(userId),
    };
  }

  static async updateProfile(userId: string, data: any) {
    // Most onboarding saves are one plain field (a name, a gender). They skip
    // the media bookkeeping and its round trips; only a media change pays them.
    const touchesMedia = data.profileVideoUrl !== undefined || data.avatarUrl !== undefined || Array.isArray(data.photos);
    const needsCurrent = touchesMedia || data.preferences !== undefined || data.birthday !== undefined || data.distancePreference !== undefined;
    // One read serves every check below that needs the saved profile.
    const current = needsCurrent ? await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        avatarUrl: true, profileVideoUrl: true, preferences: true, distancePreference: true,
        birthday: true, birthdayChangedAt: true, preferencesConfirmedAt: true,
        ...(touchesMedia ? { photos: { select: { photoUrl: true }, orderBy: { order: 'asc' as const } } } : {}),
      },
    }) : null;
    const currentMedia = {
      avatarUrl: current?.avatarUrl ?? null,
      profileVideoUrl: current?.profileVideoUrl ?? null,
      photos: (current as { photos?: { photoUrl: string }[] } | null)?.photos ?? [],
    };
    // A profile video is required, as onboarding requires it: it can be
    // replaced, never cleared. (Account deletion erases it by its own path.)
    if (data.profileVideoUrl === null && currentMedia.profileVideoUrl) {
      throw new HttpError(400, 'A profile video is required. Replace it instead of removing it.', 'PROFILE_VIDEO_REQUIRED');
    }
    const currentUrls = new Set([
      currentMedia.avatarUrl,
      currentMedia.profileVideoUrl,
      ...currentMedia.photos.map((photo) => photo.photoUrl),
    ].filter((value): value is string => !!value));
    const objectKey = (value: string): string | null => {
      let url: URL;
      try { url = new URL(value); }
      catch {
        if (currentUrls.has(value)) return null;
        throw new HttpError(400, 'Media URL is invalid', 'INVALID_MEDIA_URL');
      }
      const key = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (currentUrls.has(value)) return key.startsWith(`profiles/${userId}/`) ? key : null;
      const allowedHosts = publicMediaHosts();
      if (!allowedHosts.has(url.hostname) || !key.startsWith(`profiles/${userId}/`)) {
        throw new HttpError(400, 'Media does not belong to this account', 'MEDIA_NOT_OWNED');
      }
      return key;
    };
    // The nudity check (docs/NUDITY_CHECK.md): a new photo or video waiting for
    // the team stays off the profile - nobody sees it anywhere - until approved.
    const candidates = [data.profileVideoUrl, data.avatarUrl, ...(Array.isArray(data.photos) ? data.photos : [])]
      .filter((value): value is string => typeof value === 'string' && !currentUrls.has(value));
    const held = await ProfileNudity.heldMedia(userId, candidates);
    if (held.size) {
      if (Array.isArray(data.photos)) {
        // A held photo that replaced one keeps the old one in its place until
        // the team decides, so a replacement never costs a photo.
        const incoming = data.photos as unknown[];
        const kept = new Set(incoming.filter((value): value is string => typeof value === 'string' && !held.has(value)));
        data.photos = incoming.flatMap((value, index) => {
          if (!(typeof value === 'string' && held.has(value))) return [value];
          const replaced = currentMedia.photos[index]?.photoUrl;
          if (!replaced || kept.has(replaced)) return [];
          kept.add(replaced);
          return [replaced];
        });
      }
      if (typeof data.profileVideoUrl === 'string' && held.has(data.profileVideoUrl)) delete data.profileVideoUrl;
      if (typeof data.avatarUrl === 'string' && held.has(data.avatarUrl)) delete data.avatarUrl;
      await prisma.profileMediaAsset.updateMany({
        where: { ownerId: userId, status: 'uploaded', objectKey: { in: [...held].map((value) => objectKey(value)).filter((key): key is string => !!key) } },
        data: { status: 'held' },
      });
    }
    const supplied: Array<{ value: string; purpose: 'photo' | 'video' }> = [];
    if (typeof data.profileVideoUrl === 'string') supplied.push({ value: data.profileVideoUrl, purpose: 'video' });
    if (typeof data.avatarUrl === 'string') supplied.push({ value: data.avatarUrl, purpose: 'photo' });
    if (Array.isArray(data.photos)) data.photos.forEach((value: unknown) => { if (typeof value === 'string') supplied.push({ value, purpose: 'photo' }); });
    const newAssets = supplied
      .filter(({ value }) => !currentUrls.has(value))
      .map(({ value, purpose }) => ({ objectKey: objectKey(value)!, purpose }));
    if (newAssets.length) {
      const rows = await prisma.profileMediaAsset.findMany({
        where: { ownerId: userId, status: 'uploaded', expiresAt: { gt: new Date() }, objectKey: { in: [...new Set(newAssets.map((asset) => asset.objectKey))] } },
        select: { id: true, objectKey: true, purpose: true },
      });
      if (newAssets.some((asset) => !rows.some((row) => row.objectKey === asset.objectKey && row.purpose === asset.purpose))) {
        throw new HttpError(400, 'Media upload is not complete', 'MEDIA_UPLOAD_INCOMPLETE');
      }
    }
    // Whitelist only valid Prisma/User model fields to prevent 500 errors
    const ALLOWED_FIELDS = [
      'name', 'birthday', 'gender', 'showGender',
      'orientation', 'showOrientation', 'distancePreference',
      'seeking', 'department', 'graduationYear', 'preferences',
      'campus', 'isHosteller', 'clubs', 'hangoutSpots', 'attendanceMood', 'height',
      'yearOfStudy', 'degree',
      'showOnlineStatus',
      'showRecentlyActive',
      'distanceUnit',
      'searchDiscoverable',
      'searchByUnverified',
      'notifyLikes',
      'locationArea',
      'profileVideoUrl',
      'avatarUrl'
    ];

    const sanitizedData: any = {};
    Object.keys(data).forEach((key) => {
      if (ALLOWED_FIELDS.includes(key)) {
        sanitizedData[key] = data[key];
      } else if (key !== 'photos' && key !== 'institutionId') {
        console.warn(`[ProfileService] Ignoring unknown field: "${key}"`);
      }
    });



    // Fix: Prevent overwriting the entire preferences JSON object
    if (sanitizedData.preferences) {
      const existingPrefs = (current?.preferences as Record<string, any>) || {};
      const newPrefs = sanitizedData.preferences as Record<string, any>;
      if (Array.isArray(newPrefs.interests)) newPrefs.interests = normalizeInterests(newPrefs.interests);
      
      // Merge new preferences into existing ones
      sanitizedData.preferences = {
        ...existingPrefs,
        ...newPrefs
      };
    }

    if (sanitizedData.birthday !== undefined) {
      const existing = current!;
      const birthday = sanitizedData.birthday ? new Date(sanitizedData.birthday) : existing.birthday;
      const age = ageAt(birthday);
      if (age === null || age < 18 || age > 120) throw new HttpError(400, 'A valid adult birthday is required');
      sanitizedData.age = age;
      // After onboarding, one change in the app; later ones go through support
      // with an ID (GOOGLE_SIGNUP_PLAN.md 6.2).
      const changes = existing.birthday && birthday && existing.birthday.getTime() !== birthday.getTime();
      if (changes && existing.preferencesConfirmedAt) {
        if (existing.birthdayChangedAt) {
          throw new HttpError(403, 'You have already changed your birthday once. Ask support, with a photo of your ID.', 'BIRTHDAY_LOCKED');
        }
        sanitizedData.birthdayChangedAt = new Date();
      }
    }
    // Radius: presets only, under the same daily budget as discovery settings.
    // This route used to be a way round both (LOCATION_SPEC.md 6.3, 6.5).
    let radiusChanged = false;
    if (sanitizedData.distancePreference !== undefined) {
      const requested = Number(sanitizedData.distancePreference);
      if (!Number.isInteger(requested) || requested < 1 || requested > 100) {
        throw new HttpError(400, 'Distance must be between 5 and 100 km', 'INVALID_DISTANCE');
      }
      sanitizedData.distancePreference = toRadiusPreset(requested);
      radiusChanged = await LocationService.assertRadiusChangeAllowed(userId, current!.distancePreference, sanitizedData.distancePreference);
    }
    // The shared IEM email verifies the account; onboarding chooses the college.
    let verifiedInstitutionChoice: string | null = null;
    if (data.institutionId !== undefined) {
      const institution = typeof data.institutionId === 'string'
        ? await prisma.institution.findFirst({ where: { id: data.institutionId, isActive: true }, select: { id: true, name: true, code: true } })
        : null;
      if (!institution) throw new HttpError(400, 'Choose a college from the list.', 'COLLEGE_UNKNOWN');
      if (await StudentMembershipService.hasValidMembership(userId)) {
        const membership = await prisma.studentMembership.findUnique({ where: { userId }, include: { institution: true } });
        if (!canChooseSharedCollege(membership?.institutionalEmail, membership?.institution.code, institution.code)) {
          throw new HttpError(409, 'Your verified college cannot be changed here.', 'COLLEGE_VERIFIED');
        }
        verifiedInstitutionChoice = institution.id;
        sanitizedData.claimedInstitutionId = null;
      } else {
        sanitizedData.claimedInstitutionId = institution.id;
      }
      sanitizedData.college = institution.name;
      // A new college requires selecting its campus in a separate request.
      sanitizedData.campus = null;
      sanitizedData.campusId = null;
    }
    // Campus: resolved within the person's own institution, so the two
    // "Gurukul" campuses (Salt Lake and Jaipur) can never be confused (8.1).
    if (sanitizedData.campus !== undefined) {
      const campus = await CampusService.resolveForUser(userId, sanitizedData.campus);
      sanitizedData.campus = campus?.name ?? null;
      sanitizedData.campusId = campus?.id ?? null;
    }
    sanitizedData.eligibilityVersion = { increment: 1 };

    // Renditions travel with each photo: from its processed upload when it is
    // new, from its existing row when it is kept.
    const renditions = new Map<string, { cardUrl: string | null; thumbUrl: string | null }>();
    if (Array.isArray(data.photos)) {
      const kept = await prisma.profilePhoto.findMany({
        where: { userId },
        select: { photoUrl: true, cardUrl: true, thumbUrl: true },
      });
      kept.forEach((photo) => renditions.set(photo.photoUrl, { cardUrl: photo.cardUrl, thumbUrl: photo.thumbUrl }));
      const pending = (data.photos as unknown[])
        .filter((value): value is string => typeof value === 'string' && !renditions.get(value)?.cardUrl)
        .map((value) => ({ value, key: objectKey(value) }))
        .filter((entry): entry is { value: string; key: string } => !!entry.key);
      if (pending.length) {
        const processed = await prisma.profileMediaAsset.findMany({
          where: { ownerId: userId, purpose: 'photo', objectKey: { in: pending.map((entry) => entry.key) }, cardObjectKey: { not: null } },
          select: { objectKey: true, cardObjectKey: true, thumbObjectKey: true },
        });
        for (const entry of pending) {
          const asset = processed.find((row) => row.objectKey === entry.key);
          if (asset?.cardObjectKey) {
            renditions.set(entry.value, {
              cardUrl: s3ObjectUrl(asset.cardObjectKey),
              thumbUrl: asset.thumbObjectKey ? s3ObjectUrl(asset.thumbObjectKey) : null,
            });
          }
        }
      }
    }
    const photoRecords = data.photos && Array.isArray(data.photos)
      ? data.photos
        .filter((url: string | null) => url !== null)
        .map((url: string, index: number) => ({
          userId,
          photoUrl: url,
          cardUrl: renditions.get(url)?.cardUrl ?? null,
          thumbUrl: renditions.get(url)?.thumbUrl ?? null,
          isPrimary: index === 0,
          order: index,
        }))
      : null;
    if (photoRecords?.length && !sanitizedData.avatarUrl) {
      sanitizedData.avatarUrl = photoRecords[0].photoUrl;
    }
    if (sanitizedData.profileVideoUrl !== undefined && sanitizedData.profileVideoUrl !== currentMedia.profileVideoUrl) {
      sanitizedData.videoPreviewUrl = null;
      sanitizedData.videoPosterUrl = null;
      sanitizedData.videoPlaybackUrl = null;
    }
    const finalUrls = [
      sanitizedData.profileVideoUrl !== undefined ? sanitizedData.profileVideoUrl : currentMedia.profileVideoUrl,
      sanitizedData.avatarUrl !== undefined ? sanitizedData.avatarUrl : currentMedia.avatarUrl,
      ...(photoRecords ? photoRecords.map((photo: any) => photo.photoUrl) : currentMedia.photos.map((photo) => photo.photoUrl)),
    ].filter((value): value is string => typeof value === 'string');
    const finalAssetKeys = finalUrls.map((value) => objectKey(value)).filter((value): value is string => !!value);

    // Real-person check (PHOTO_VERIFICATION_PLAN.md 5): a new main photo must
    // show the person whose face key this is - refused before anything saves.
    const newMain = photoRecords?.[0]?.photoUrl;
    if (newMain && newMain !== currentMedia.photos[0]?.photoUrl) {
      await FaceVerificationService.assertMainPhoto(userId, newMain);
    }
    const saveUser = (client: Prisma.TransactionClient) => client.user.update({
      where: { id: userId },
      data: sanitizedData,
      select: PROFILE_UPDATE_SELECT,
    });
    // A plain field change touches only the user row. Selecting relations in
    // the update makes Prisma wrap it in a transaction of seven sequential
    // statements; reading the unchanged relations alongside it is one round trip.
    const sideWrites = touchesMedia || !!verifiedInstitutionChoice || radiusChanged;
    const updatedProfile = !sideWrites ? await Promise.all([
      prisma.user.update({ where: { id: userId }, data: sanitizedData, select: PROFILE_SCALAR_SELECT }),
      prisma.studentMembership.findUnique({ where: { userId }, ...PROFILE_MEMBERSHIP_SELECT }),
      prisma.profilePhoto.findMany({ where: { userId }, ...PROFILE_PHOTOS_QUERY }),
    ]).then(([user, studentMembership, photos]) => ({ ...user, studentMembership, photos })) : await prisma.$transaction(async (tx) => {
      if (verifiedInstitutionChoice) {
        await tx.studentMembership.update({where: {userId}, data: {institutionId: verifiedInstitutionChoice}});
      }
      if (photoRecords) {
        await tx.profilePhoto.deleteMany({ where: { userId } });
        if (photoRecords.length) await tx.profilePhoto.createMany({ data: photoRecords });
      }
      if (touchesMedia) {
        await tx.profileMediaAsset.updateMany({
          where: { ownerId: userId, status: 'attached', ...(finalAssetKeys.length ? { objectKey: { notIn: finalAssetKeys } } : {}) },
          data: { status: 'retired' },
        });
      }
      if (newAssets.length) {
        await tx.profileMediaAsset.updateMany({
          where: { ownerId: userId, status: 'uploaded', objectKey: { in: newAssets.map((asset) => asset.objectKey) } },
          data: { status: 'attached', attachedAt: new Date() },
        });
      }
      const newVideo = newAssets.find((asset) => asset.purpose === 'video');
      if (newVideo) {
        // objectKey is unique, so this is one statement rather than a
        // lookup followed by an update. Every saved round trip matters: the
        // database is a continent away and this all runs in one transaction.
        const videoAsset = await tx.profileMediaAsset.update({
          where: { objectKey: newVideo.objectKey },
          data: { processingStatus: 'pending', processingError: null },
          select: { id: true },
        });
        await OutboxService.enqueue(tx, {
          topic: OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED,
          aggregateId: videoAsset.id,
          deduplicationKey: `${OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED}:${videoAsset.id}`,
          payload: { assetId: videoAsset.id, ownerId: userId },
        });
      }
      if (radiusChanged) {
        await tx.analyticsEvent.create({ data: { userId, eventType: 'radius_changed', eventData: {} } });
      }
      return saveUser(tx);
    }, {
      // Several statements run sequentially against a database in another
      // region, so the 5s default is spent on round trips rather than work.
      timeout: 20_000,
      maxWait: 10_000,
    });
    // Every photo and video change is checked against the face key (5). A new
    // video alone used to skip this, leaving "your video needs a look" behind
    // after the person had replaced it.
    const videoChanged = sanitizedData.profileVideoUrl !== undefined && sanitizedData.profileVideoUrl !== currentMedia.profileVideoUrl;
    if (photoRecords || videoChanged) await FaceVerificationService.afterMediaChange(userId);

    // Invalidate the cache after updating profile to clear stale media URLs
    await MediaCacheService.invalidateCache(userId);
    // Anyone looking at this profile in Search right now re-reads it: a new
    // photo shows while they look. A bare nudge - they re-read through the
    // same rules that let them find this person at all.
    getIO()?.to(`profile-watch:${userId}`).emit('profile_changed', { userId });
    // Their own other phones follow too.
    announceOwnProfile(userId);

    return {
      ...updatedProfile,
      isVerified: collegeVerified(updatedProfile.studentMembership),
      blueBadge: blueBadge(collegeVerified(updatedProfile.studentMembership), updatedProfile.realPersonVerifiedAt),
      studentMembership: undefined,
      realPersonVerifiedAt: undefined,
      profileVideoUrl: updatedProfile.profileVideoUrl ? transformToCdnUrl(updatedProfile.profileVideoUrl) : null,
      videoPreviewUrl: updatedProfile.videoPreviewUrl ? transformToCdnUrl(updatedProfile.videoPreviewUrl) : null,
      avatarUrl: updatedProfile.avatarUrl ? transformToCdnUrl(updatedProfile.avatarUrl) : null,
      photos: updatedProfile.photos.map(p => ({
        ...p,
        photoUrl: transformToCdnUrl(p.photoUrl)
      })),
      pendingMedia: await ProfileNudity.pendingFor(userId),
    };
  }
}
