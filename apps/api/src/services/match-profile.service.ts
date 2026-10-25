import { prisma } from '../utils/prisma';
import { MatchAccessService } from './match-access.service';
import { AlgorithmConfigService } from './algorithm-config.service';
import { discoveryProfileSelect, publicProfile } from './public-profile.service';

/**
 * A matched person's full profile - photos, About me, interests - the same
 * shape and renditions Discovery cards use, reached from a match rather than
 * the swipe deck. Nothing in the app could open this before: Chat's own
 * profile screen is a settings menu (mute, report, block), never the
 * profile itself. Requires an active match; there is no equivalent for a
 * follower you have not matched, since nothing here is public.
 */
export class MatchProfileService {
  static async get(viewerId: string, matchId: string) {
    const match = await MatchAccessService.requireActiveMatch(viewerId, matchId);
    const otherId = match.user1Id === viewerId ? match.user2Id : match.user1Id;
    const [viewer, other, config] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: discoveryProfileSelect }),
      prisma.user.findUniqueOrThrow({ where: { id: otherId }, select: discoveryProfileSelect }),
      AlgorithmConfigService.get(),
    ]);
    return publicProfile(viewer, other, config.weights);
  }
}
