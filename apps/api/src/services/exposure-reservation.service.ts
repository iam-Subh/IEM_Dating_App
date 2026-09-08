import { redisClient } from "../utils/redis";
export class ExposureReservationService {
  static key(candidate: string) {
    return `discovery:pending:{${candidate}}`;
  }
  static member(viewer: string, deck: string, sequence: number) {
    return `${viewer}:${deck}:${sequence}`;
  }
  static async claim(
    candidate: string,
    member: string,
    capacity: number,
    seconds: number,
  ) {
    return (await this.claimDetailed(candidate, member, capacity, seconds)).claimed;
  }
  static async claimDetailed(candidate: string, member: string, capacity: number, seconds: number) {
    // Redis time avoids cross-instance clock skew. Claim and capacity check are atomic.
    const result = await redisClient.eval(
      `
      local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
      redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
      if redis.call('ZSCORE',KEYS[1],ARGV[1]) then return {1,redis.call('ZCARD',KEYS[1])} end
      if redis.call('ZCARD',KEYS[1]) >= tonumber(ARGV[2]) then return {0,redis.call('ZCARD',KEYS[1])} end
      redis.call('ZADD',KEYS[1],now+tonumber(ARGV[3])*1000,ARGV[1])
      local last=redis.call('ZREVRANGE',KEYS[1],0,0,'WITHSCORES')
      redis.call('PEXPIRE',KEYS[1],math.max(1,tonumber(last[2])-now))
      return {1,redis.call('ZCARD',KEYS[1])}`,
      1,
      this.key(candidate),
      member,
      capacity,
      seconds,
    );
    const [claimed, pendingCount] = result as [number, number];
    return { claimed: claimed === 1, pendingCount };
  }
  static async release(candidate: string, member: string) {
    await redisClient.zrem(this.key(candidate), member);
  }
}
