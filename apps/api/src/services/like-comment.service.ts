import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { transformToCdnUrl } from "../middlewares/upload.middleware";
import { checkNote } from "./note-safety";

/** As long as a Rose note: one thought, not a letter. */
export const LIKE_COMMENT_MAX = 140;
/** How much of the bio a comment keeps, to show what it answered. */
const ABOUT_TEXT_MAX = 160;

/** What a comment is about, as the app sends it: a photo it was shown, or the bio. */
export type CommentAbout = { kind: "photo"; photoUrl: string } | { kind: "bio" };

/** The same, as Likes You and the chat show it. */
export type CommentShown = {
  id: string;
  text: string;
  about: { kind: "photo"; photoUrl: string | null } | { kind: "bio"; text: string | null };
};

/**
 * A comment on one photo or the bio, sent with a Like (or a Rose), as on
 * Hinge. A note from someone not yet matched, so it passes the same check as
 * a Rose note, and only the recipient ever reads it: on Likes You, and as the
 * first message if they like back. The push never carries its words.
 */
export class LikeCommentService {
  /**
   * Whether the like_comments table exists yet. A server can run before its
   * migration (20261027100000_like_comments) is applied; until then comments
   * are off, and matches and Likes You work exactly as before - a query on a
   * missing table inside the match transaction would abort the whole match.
   * A "no" is asked again after a minute; a "yes" is kept.
   */
  private static ready: { value: boolean; at: number } | null = null;
  static async available(): Promise<boolean> {
    const known = LikeCommentService.ready;
    if (known && (known.value || Date.now() - known.at < 60_000)) return known.value;
    try {
      const [row] = await prisma.$queryRaw<{ found: boolean }[]>`SELECT to_regclass('public.like_comments') IS NOT NULL AS found`;
      LikeCommentService.ready = { value: !!row?.found, at: Date.now() };
    } catch {
      LikeCommentService.ready = { value: false, at: Date.now() };
    }
    return LikeCommentService.ready.value;
  }

  /** Refuses contact details and abuse, before anything is written (note-safety.ts). */
  static check(comment: string) {
    const verdict = checkNote(comment);
    if (!verdict.ok)
      throw new HttpError(
        422,
        verdict.reason === "contact"
          ? "Comments can't include phone numbers, emails, links or handles."
          : "This comment can't be sent. Try rewording it.",
        "LIKE_COMMENT_REJECTED",
      );
  }

  /**
   * What the comment is about, checked against the profile as it is now:
   * a photo must still be one of theirs, a bio must still be there.
   */
  static async resolve(tx: Prisma.TransactionClient, targetId: string, about: CommentAbout) {
    if (about.kind === "bio") {
      // The bio lives in preferences, as publicPreferences reads it.
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { preferences: true } });
      const prefs = target?.preferences;
      const raw = prefs && typeof prefs === "object" && !Array.isArray(prefs) ? (prefs as Record<string, unknown>).bio : null;
      const bio = typeof raw === "string" ? raw.trim() : "";
      if (!bio) throw new HttpError(409, "Their bio has changed. Take another look.", "COMMENT_TARGET_GONE");
      return { aboutKind: "bio", aboutText: bio.slice(0, ABOUT_TEXT_MAX), aboutPhotoId: null, aboutPhotoUrl: null };
    }
    const photos = await tx.profilePhoto.findMany({
      where: { userId: targetId },
      select: { id: true, photoUrl: true, cardUrl: true, thumbUrl: true },
    });
    // The app is shown the card rendition through the CDN (publicProfile);
    // any of a photo's forms names it.
    const sent = stripQuery(about.photoUrl);
    const photo = photos.find((entry) =>
      [entry.photoUrl, entry.cardUrl, entry.thumbUrl]
        .filter((url): url is string => !!url)
        .some((url) => stripQuery(url) === sent || stripQuery(transformToCdnUrl(url)) === sent),
    );
    if (!photo) throw new HttpError(409, "That photo has changed. Take another look.", "COMMENT_TARGET_GONE");
    return {
      aboutKind: "photo",
      aboutText: null,
      aboutPhotoId: photo.id,
      aboutPhotoUrl: photo.thumbUrl ?? photo.cardUrl ?? photo.photoUrl,
    };
  }

  static async recordWithin(
    tx: Prisma.TransactionClient,
    data: { swipeId: string; senderId: string; recipientId: string; comment: string; about: Awaited<ReturnType<typeof LikeCommentService.resolve>> },
  ) {
    await tx.likeComment.create({
      data: {
        swipeId: data.swipeId,
        senderId: data.senderId,
        recipientId: data.recipientId,
        comment: data.comment.trim().slice(0, LIKE_COMMENT_MAX),
        ...data.about,
      },
    });
  }

  /** The latest comment each of these people sent me, for Likes You. */
  static async received(recipientId: string, senderIds: string[]) {
    const out = new Map<string, CommentShown>();
    if (!senderIds.length || !(await LikeCommentService.available())) return out;
    const rows = await prisma.likeComment.findMany({
      where: { recipientId, senderId: { in: senderIds } },
      orderBy: { createdAt: "desc" },
    });
    for (const row of rows) if (!out.has(row.senderId)) out.set(row.senderId, LikeCommentService.shown(row));
    return out;
  }

  static shown(row: { id: string; comment: string; aboutKind: string; aboutPhotoUrl: string | null; aboutText: string | null }): CommentShown {
    return {
      id: row.id,
      text: row.comment,
      about: row.aboutKind === "photo"
        ? { kind: "photo", photoUrl: row.aboutPhotoUrl ? transformToCdnUrl(row.aboutPhotoUrl) : null }
        : { kind: "bio", text: row.aboutText },
    };
  }
}

function stripQuery(url: string) {
  return url.split("?")[0];
}
