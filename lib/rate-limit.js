import { RateLimit } from './models.js';

export async function useRateLimit(userId, action, max) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `${userId}:${action}:${hour}`;
  const expiresAt = new Date((hour + 2) * 3_600_000);
  let entry;
  try {
    entry = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    entry = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { returnDocument: 'after' });
  }
  if (entry.count > max) {
    const error = new Error('Too many requests. Try again later.');
    error.status = 429;
    throw error;
  }
}
