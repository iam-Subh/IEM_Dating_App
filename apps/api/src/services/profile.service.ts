import { normalizeInterests } from "@iem-dating/shared/interest-catalog";
import { ageAt } from './eligibility.service';
import { HttpError } from '../utils/httpError';
import { prisma } from '../utils/prisma';
import { MediaCacheService } from './mediaCache.service';
import { transformToCdnUrl } from '../middlewares/upload.middleware';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';

export class ProfileService {
  static async getProfile(userId: string) {
    const profile = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
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
        studentMembership: {
          select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
        },
        accountStatus: true,
        profileVideoUrl: true,
        videoPreviewUrl: true,
        avatarUrl: true,
        locationArea: true,
        lastActiveAt: true,
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
      isVerified: profile.studentMembership?.status === 'verified' &&
        !!profile.studentMembership.verifiedAt &&
        profile.studentMembership.institution.isActive &&
        (!profile.studentMembership.expiresAt || profile.studentMembership.expiresAt > new Date()),
      studentMembership: undefined,
      profileVideoUrl: profile.profileVideoUrl ? transformToCdnUrl(profile.profileVideoUrl) : null,
      videoPreviewUrl: profile.videoPreviewUrl ? transformToCdnUrl(profile.videoPreviewUrl) : null,
      avatarUrl: profile.avatarUrl ? transformToCdnUrl(profile.avatarUrl) : null,
      photos: profile.photos.map(p => ({
        ...p,
        photoUrl: transformToCdnUrl(p.photoUrl)
      }))
    };
  }

  static async updateProfile(userId: string, data: any) {
    const currentMedia = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarUrl: true, profileVideoUrl: true, photos: { select: { photoUrl: true } } },
    });
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
      const bucket = process.env.AWS_S3_BUCKET_NAME;
      const region = process.env.AWS_REGION || 'us-east-1';
      const allowedHosts = new Set<string>();
      if (bucket) allowedHosts.add(`${bucket}.s3.${region}.amazonaws.com`);
      if (process.env.CDN_URL) {
        try { allowedHosts.add(new URL(process.env.CDN_URL).hostname); } catch { /* Startup configuration handles invalid services. */ }
      }
      if (!allowedHosts.has(url.hostname) || !key.startsWith(`profiles/${userId}/`)) {
        throw new HttpError(400, 'Media does not belong to this account', 'MEDIA_NOT_OWNED');
      }
      return key;
    };
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
      'locationArea',
      'profileVideoUrl',
      'avatarUrl'
    ];

    const sanitizedData: any = {};
    Object.keys(data).forEach((key) => {
      if (ALLOWED_FIELDS.includes(key)) {
        sanitizedData[key] = data[key];
      } else if (key !== 'photos') {
        console.warn(`[ProfileService] Ignoring unknown field: "${key}"`);
      }
    });



    // Fix: Prevent overwriting the entire preferences JSON object
    if (sanitizedData.preferences) {
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { preferences: true }
      });
      
      const existingPrefs = (existingUser?.preferences as Record<string, any>) || {};
      const newPrefs = sanitizedData.preferences as Record<string, any>;
      if (Array.isArray(newPrefs.interests)) newPrefs.interests = normalizeInterests(newPrefs.interests);
      
      // Merge new preferences into existing ones
      sanitizedData.preferences = {
        ...existingPrefs,
        ...newPrefs
      };
    }

    if (sanitizedData.birthday !== undefined) {
      const existing = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const birthday = sanitizedData.birthday ? new Date(sanitizedData.birthday) : existing.birthday;
      const age = ageAt(birthday);
      if (age === null || age < 18 || age > 120) throw new HttpError(400, 'A valid adult birthday is required');
      sanitizedData.age = age;
    }
    sanitizedData.eligibilityVersion = { increment: 1 };

    const photoRecords = data.photos && Array.isArray(data.photos)
      ? data.photos
        .filter((url: string | null) => url !== null)
        .map((url: string, index: number) => ({
          userId,
          photoUrl: url,
          isPrimary: index === 0,
          order: index,
        }))
      : null;
    if (photoRecords?.length && !sanitizedData.avatarUrl) {
      sanitizedData.avatarUrl = photoRecords[0].photoUrl;
    }
    if (sanitizedData.profileVideoUrl !== undefined && sanitizedData.profileVideoUrl !== currentMedia.profileVideoUrl) {
      sanitizedData.videoPreviewUrl = null;
    }
    const finalUrls = [
      sanitizedData.profileVideoUrl !== undefined ? sanitizedData.profileVideoUrl : currentMedia.profileVideoUrl,
      sanitizedData.avatarUrl !== undefined ? sanitizedData.avatarUrl : currentMedia.avatarUrl,
      ...(photoRecords ? photoRecords.map((photo: any) => photo.photoUrl) : currentMedia.photos.map((photo) => photo.photoUrl)),
    ].filter((value): value is string => typeof value === 'string');
    const finalAssetKeys = finalUrls.map((value) => objectKey(value)).filter((value): value is string => !!value);

    const updatedProfile = await prisma.$transaction(async (tx) => {
      if (photoRecords) {
        await tx.profilePhoto.deleteMany({ where: { userId } });
        if (photoRecords.length) await tx.profilePhoto.createMany({ data: photoRecords });
      }
      await tx.profileMediaAsset.updateMany({
        where: { ownerId: userId, status: 'attached', ...(finalAssetKeys.length ? { objectKey: { notIn: finalAssetKeys } } : {}) },
        data: { status: 'retired' },
      });
      if (newAssets.length) {
        await tx.profileMediaAsset.updateMany({
          where: { ownerId: userId, status: 'uploaded', objectKey: { in: newAssets.map((asset) => asset.objectKey) } },
          data: { status: 'attached', attachedAt: new Date() },
        });
      }
      const newVideo = newAssets.find((asset) => asset.purpose === 'video');
      if (newVideo) {
        const videoAsset = await tx.profileMediaAsset.findUniqueOrThrow({
          where: { objectKey: newVideo.objectKey },
          select: { id: true },
        });
        await tx.profileMediaAsset.update({
          where: { id: videoAsset.id },
          data: { processingStatus: 'pending', processingError: null },
        });
        await OutboxService.enqueue(tx, {
          topic: OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED,
          aggregateId: videoAsset.id,
          deduplicationKey: `${OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED}:${videoAsset.id}`,
          payload: { assetId: videoAsset.id, ownerId: userId },
        });
      }
      return tx.user.update({
      where: { id: userId },
      data: sanitizedData,
      select: {
        id: true,
        name: true,
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
        isHosteller: true,
        clubs: true,
        hangoutSpots: true,
        distancePreference: true,
        preferences: true,
        isVerified: true,
        studentMembership: {
          select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
        },
        profileVideoUrl: true,
        videoPreviewUrl: true,
        avatarUrl: true,
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
    });

    // Invalidate the cache after updating profile to clear stale media URLs
    await MediaCacheService.invalidateCache(userId);

    return {
      ...updatedProfile,
      isVerified: updatedProfile.studentMembership?.status === 'verified' &&
        !!updatedProfile.studentMembership.verifiedAt &&
        updatedProfile.studentMembership.institution.isActive &&
        (!updatedProfile.studentMembership.expiresAt || updatedProfile.studentMembership.expiresAt > new Date()),
      studentMembership: undefined,
      profileVideoUrl: updatedProfile.profileVideoUrl ? transformToCdnUrl(updatedProfile.profileVideoUrl) : null,
      videoPreviewUrl: updatedProfile.videoPreviewUrl ? transformToCdnUrl(updatedProfile.videoPreviewUrl) : null,
      avatarUrl: updatedProfile.avatarUrl ? transformToCdnUrl(updatedProfile.avatarUrl) : null,
      photos: updatedProfile.photos.map(p => ({
        ...p,
        photoUrl: transformToCdnUrl(p.photoUrl)
      }))
    };
  }
}
