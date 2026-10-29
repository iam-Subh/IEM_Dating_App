import { VerificationLimitsService } from './verification-limits.service';
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { asViewer, likeBackAllowed, loadEligibilityParties, mutuallyEligible } from "./eligibility.service";
import { ChatEventService } from "./chat-event.service";
import { checkNote } from "./note-safety";
import { interestSignals } from "./reciprocity.service";
import { OUTBOX_TOPICS, OutboxService } from "./outbox.service";
import { AccountEventService } from "./account-event.service";
import { RoseService } from "./rose.service";
import { type CommentAbout, LikeCommentService } from "./like-comment.service";
import { LIKE_GRACE_MS, LikesService } from "./likes.service";
import { REWIND_WINDOW_SECONDS } from "./rewind.service";
export class SwipeService {
  static async perform(
    viewerId: string,
    targetId: string,
    action: "like" | "pass",
    rose?: { comment?: string | null },
    /** A comment on one photo or the bio, sent with this Like (like-comment.service.ts). */
    note?: { comment: string; about: CommentAbout },
  ) {
    if (viewerId === targetId || !["like", "pass"].includes(action))
      throw new HttpError(400, "Invalid swipe");
    // A Rose is a Like with priority, never a Pass (EXPLORE_SPEC.md, section 10).
    if (rose && action !== "like")
      throw new HttpError(400, "A Rose can only be sent with a Like", "ROSE_REQUIRES_LIKE");
    // Checked before the transaction, so a refused note never spends the Rose
    // (STANDOUTS_LIKES_SPEC.md 4.5).
    if (note && action !== "like")
      throw new HttpError(400, "A comment can only be sent with a Like", "COMMENT_REQUIRES_LIKE");
    if (note) {
      LikeCommentService.check(note.comment);
      if (!(await LikeCommentService.available()))
        throw new HttpError(503, "Comments aren't available yet. Send a Like without one.", "COMMENTS_UNAVAILABLE");
    }
    // Read once, outside the transaction: the match below looks for a comment only once the table exists.
    const commentsReady = await LikeCommentService.available();
    if (rose?.comment) {
      const verdict = checkNote(rose.comment);
      if (!verdict.ok)
        throw new HttpError(
          422,
          verdict.reason === "contact"
            ? "Notes can't include phone numbers, emails, links or handles."
            : "This note can't be sent. Try rewording it.",
          "ROSE_COMMENT_REJECTED",
        );
    }
    const [a, b] = [viewerId, targetId].sort();
    // Set when this swipe answers a Like the viewer had received: their own
    // Likes You (on every device) loses that card.
    let answeredIncoming = false;
    const result = await prisma.$transaction(
      async (tx) => {
        // Pair-level transaction lock covers both swipe directions and reversed match pairs.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${a}:${b}`}, 0))`;
        await tx.$queryRaw`SELECT id FROM users WHERE id IN (${a}::uuid,${b}::uuid) ORDER BY id FOR UPDATE`;
        const previous = await tx.swipe.findUnique({
          where: { swiperId_targetId: { swiperId: viewerId, targetId } },
        });
        if (previous) {
          if (previous.action !== action)
            throw new HttpError(
              409,
              "This profile already has a different decision",
              "SWIPE_CONFLICT",
            );
          // A Rose has to be the first move: a Like already sent can't become
          // one later (Hinge's rule). A retried Rose request is still a replay.
          // A comment, like a Rose, rides on the first Like only.
          if (note && !rose) {
            const sent = await tx.likeComment.findUnique({ where: { swipeId: previous.id }, select: { id: true } });
            if (!sent)
              throw new HttpError(409, "You already liked this person.", "COMMENT_NOT_FIRST");
          }
          if (rose) {
            const spent = await tx.rose.findFirst({ where: { swipeId: previous.id }, select: { id: true } });
            if (!spent)
              throw new HttpError(
                409,
                "You already liked this person. A Rose has to be your first move.",
                "ROSE_NOT_FIRST",
              );
          }
          const match = await tx.match.findFirst({
            where: {
              OR: [
                { user1Id: a, user2Id: b },
                { user1Id: b, user2Id: a },
              ],
              status: "active",
            },
          });
          return {
            status: "recorded",
            targetId,
            action,
            matchCreated: false,
            matched: !!match,
            matchId: match?.id,
            repeated: true,
            // A replay recorded nothing new, so there is no fresh window.
            rewindableUntil: null,
          };
        }
        const [viewer, target, blocked, matched, reverse, parties] = await Promise.all([
          tx.user.findUnique({ where: { id: viewerId } }),
          tx.user.findUnique({ where: { id: targetId } }),
          tx.userBlock.findFirst({
            where: {
              OR: [
                { blockerId: a, blockedId: b },
                { blockerId: b, blockedId: a },
              ],
            },
          }),
          tx.match.findFirst({
            where: {
              OR: [
                { user1Id: a, user2Id: b },
                { user1Id: b, user2Id: a },
              ],
            },
          }),
          tx.swipe.findUnique({
            where: {
              swiperId_targetId: { swiperId: targetId, targetId: viewerId },
            },
          }),
          // Verified membership, institution and campus anchor for each side:
          // the college scope and campus-anchor rules need all three.
          loadEligibilityParties(tx, [viewerId, targetId]),
        ]);
        if (
          !viewer ||
          !target ||
          blocked ||
          matched ||
          reverse?.action === "pass" ||
          // asViewer: someone hidden at a place can still like, and be liked back.
          (!mutuallyEligible(asViewer(viewer), asViewer(target), { a: parties.get(viewerId), b: parties.get(targetId) }) &&
            // Answering a Like already received: the Like-back rule, the same
            // one Likes You lists by, so a listed Like can always be answered
            // (STANDOUTS_LIKES_SPEC.md 4.1). Only ever widens, never refuses.
            !(action === "like" && reverse?.action === "like" &&
              likeBackAllowed(viewer, target, { recipient: parties.get(viewerId), sender: parties.get(targetId) })))
        )
          throw new HttpError(
            409,
            "This profile is no longer available",
            "PROFILE_UNAVAILABLE",
          );
        answeredIncoming = reverse?.action === "like";
        // Before verifying: 25 likes a day, and none once the profile has
        // paused (GOOGLE_SIGNUP_PLAN.md 2.2, 2.6). A pass is always allowed.
        if (action === "like") await VerificationLimitsService.requireCanLike(tx, viewer);
        // The photo or bio is checked before anything is spent or written.
        const about = note ? await LikeCommentService.resolve(tx, targetId, note.about) : null;
        // The Rose is checked and spent inside this transaction, before the
        // swipe row exists, so a refusal here leaves no Like and no deduction.
        const spent = rose ? await RoseService.spendWithin(tx, viewerId, targetId, rose.comment ?? null) : null;
        // Snapshot only model inputs at decision time. Do not infer historical inputs later.
        const swipe = await tx.swipe.create({
          data: { swiperId: viewerId, targetId, action, targetSignals: interestSignals(target) },
        });
        if (spent) await RoseService.recordWithin(tx, viewerId, targetId, swipe.id, spent.comment);
        if (note && about)
          await LikeCommentService.recordWithin(tx, { swipeId: swipe.id, senderId: viewerId, recipientId: targetId, comment: note.comment, about });
        await tx.userScore.upsert({
          where: { userId: viewerId },
          create: {
            userId: viewerId,
            totalSwipesOut: 1,
            totalRightSwipes: action === "like" ? 1 : 0,
          },
          update: {
            totalSwipesOut: { increment: 1 },
            totalRightSwipes: { increment: action === "like" ? 1 : 0 },
          },
        });
        await tx.userScore.upsert({
          where: { userId: targetId },
          create: {
            userId: targetId,
            totalSwipesReceived: 1,
            totalLikesReceived: action === "like" ? 1 : 0,
          },
          update: {
            totalSwipesReceived: { increment: 1 },
            totalLikesReceived: { increment: action === "like" ? 1 : 0 },
          },
        });
        await tx.user.update({
          where: { id: viewerId },
          data: { lastActiveAt: new Date() },
        });
        await tx.profileImpression.updateMany({
          where: {
            viewerId,
            shownId: targetId,
            day: new Date(new Date().toISOString().slice(0, 10)),
          },
          data: { acted: true },
        });
        let matchId: string | undefined;
        if (action === "like" && reverse?.action === "like") {
          const match = await tx.match.create({
            data: { user1Id: a, user2Id: b, status: "active" },
          });
          matchId = match.id;
          await SwipeService.openWithRoseNote(tx, matchId, viewerId, targetId, commentsReady);
          await AccountEventService.append(tx, { userIds: [a, b], type: 'conversation.updated', matchId, payload: { reason: 'match_created' } });
          await OutboxService.enqueue(tx, {
            topic: OUTBOX_TOPICS.MATCH_CREATED,
            aggregateId: matchId,
            deduplicationKey: `match.created:${matchId}`,
            payload: { user1Id: a, user2Id: b },
          });
          await tx.analyticsEvent.create({
            data: {
              userId: viewerId,
              eventType: "match_created",
              eventData: { matchId, user1Id: a, user2Id: b },
            },
          });
        }
        if (action === "like" && !matchId) {
          // Tells the recipient - live, and by push, batched and without a
          // name (4.4) - once the sender's Rewind window has closed: a Like
          // taken back inside it is never seen at all (LIKE_GRACE_MS).
          await OutboxService.enqueue(tx, {
            topic: OUTBOX_TOPICS.LIKE_RECEIVED,
            aggregateId: swipe.id,
            deduplicationKey: `like.received:${swipe.id}`,
            // What was commented on, if anything - never the words (4.4).
            payload: { recipientId: targetId, rose: !!spent, ...(about ? { commented: about.aboutKind } : {}) },
            availableAt: new Date(swipe.createdAt.getTime() + LIKE_GRACE_MS),
          });
        }
        await tx.analyticsEvent.create({
          data: {
            userId: viewerId,
            eventType: "swipe",
            eventData: {
              swipeId: swipe.id,
              targetId,
              action,
              matchId: matchId ?? null,
            },
          },
        });
        return {
          status: "recorded",
          targetId,
          action,
          matchCreated: !!matchId,
          matched: !!matchId,
          matchId,
          repeated: false,
          // The authoritative Rewind deadline, measured from the row the
          // database actually wrote. The app cannot compute this itself: it
          // would have to start counting when the *response* arrives, which is
          // a round-trip later than the server's clock, so the last seconds of
          // its countdown would always lose the race.
          rewindableUntil: matchId
            ? null // a match is never rewindable; the other person can see it
            : new Date(swipe.createdAt.getTime() + REWIND_WINDOW_SECONDS * 1000).toISOString(),
        };
      },
      { timeout: 15000 },
    );
    if (answeredIncoming && !result.repeated) LikesService.nudge([viewerId]);
    return result;
  }

  /**
   * A Rose note becomes the first message of the match it started
   * (STANDOUTS_LIKES_SPEC.md 4.3), sent by the Rose's sender - it is what they
   * meant the note to be, and it gives the match somewhere to begin. Written
   * in the match's own transaction so the chat never exists without it.
   */
  private static async openWithRoseNote(
    tx: Prisma.TransactionClient,
    matchId: string,
    a: string,
    b: string,
    commentsReady: boolean,
  ) {
    const comment = !commentsReady ? null : await tx.likeComment.findFirst({
      where: {
        OR: [
          { senderId: a, recipientId: b },
          { senderId: b, recipientId: a },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    const note = comment
      ? { id: comment.id, senderId: comment.senderId, recipientId: comment.recipientId, comment: comment.comment }
      : await tx.rose.findFirst({
      where: {
        OR: [
          { senderId: a, recipientId: b },
          { senderId: b, recipientId: a },
        ],
        comment: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, senderId: true, recipientId: true, comment: true },
    });
    const content = note?.comment?.trim();
    const roseWith = comment
      ? await tx.rose.findFirst({ where: { swipeId: comment.swipeId }, select: { id: true } })
      : null;
    const metadata = comment
      ? {
          likeNote: true,
          ...(roseWith ? { roseNote: true, roseId: roseWith.id } : {}),
          commentId: comment.id,
          about: LikeCommentService.shown(comment).about,
        }
      : { roseNote: true, roseId: note?.id };
    if (!note || !content) return;
    const session = await tx.chatSession.upsert({
      where: { matchId },
      create: { matchId, lastMessageAt: new Date(), lastMessageSeq: 1 },
      update: { lastMessageAt: new Date(), lastMessageSeq: { increment: 1 } },
      select: { lastMessageSeq: true },
    });
    const message = await tx.message.create({
      data: {
        matchId,
        senderId: note.senderId,
        content,
        type: "text",
        messageSeq: session.lastMessageSeq,
        metadata,
      },
      select: { id: true, messageSeq: true },
    });
    await Promise.all([
      tx.chatParticipant.upsert({
        where: { matchId_userId: { matchId, userId: note.senderId } },
        create: { matchId, userId: note.senderId },
        update: {},
      }),
      tx.chatParticipant.upsert({
        where: { matchId_userId: { matchId, userId: note.recipientId } },
        create: { matchId, userId: note.recipientId, unreadCount: 1 },
        update: { unreadCount: { increment: 1 } },
      }),
      tx.messageReceipt.create({ data: { messageId: message.id, recipientId: note.recipientId } }),
    ]);
    await ChatEventService.append(tx, {
      matchId,
      type: "message.created",
      actorId: note.senderId,
      entityId: message.id,
      payload: { messageId: message.id, messageSeq: message.messageSeq ?? 0 },
    });
  }
}
