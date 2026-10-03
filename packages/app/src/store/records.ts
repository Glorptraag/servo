// One profile's run records and card-game results (docs/store.md). Both are only ever added: a Run is stored as the
// schema's RunRecord, and the card game's latest round is the one that counts (D40). Each list is oldest first, by
// the record's own time and then by the order the records were added.
import { validateRunRecord } from '@servo/schema';
import type { ProfileId } from '@servo/schema';
import { recordChange } from './changes.ts';
import { compareText, isRecord, refusal, requireProfile } from './context.ts';
import type { StoreContext } from './context.ts';
import type { CardGameResult, CardGames, CardMark, Runs } from './index.ts';
import { uuidV4 } from './uuid.ts';

export const runsOf = (ctx: StoreContext, profile: ProfileId): Runs => {
  const { db, content, now } = ctx;
  return {
    add: async (record) => {
      const result = validateRunRecord(record, content.catalogue);
      if (!result.ok) throw refusal(`The run record does not validate: ${result.issues[0]?.message ?? 'no reason given'}`, result.issues);
      const run = result.value;
      if (run.profile !== undefined && run.profile !== profile) throw refusal(`The run record '${run.id}' names another profile.`);
      await db.transaction('rw', [db.profiles, db.runs, db.changes], async () => {
        await requireProfile(ctx, profile);
        if (await db.runs.get({ id: run.id })) throw refusal(`A run record '${run.id}' is already stored. Runs are only ever added.`);
        const found = run.challenge === undefined ? {} : { challenge: run.challenge };
        await db.runs.add({ id: run.id, profile, blueprintId: run.blueprintId, ...found, record: run });
        await recordChange(db, { collection: 'runs', id: run.id, profile, updatedAt: now(), removed: false });
      });
    },

    list: async (filter = {}) => {
      const { blueprintId, challenge } = filter;
      const rows =
        blueprintId !== undefined
          ? await db.runs.where('[profile+blueprintId]').equals([profile, blueprintId]).toArray()
          : typeof challenge === 'string'
            ? await db.runs.where('[profile+challenge]').equals([profile, challenge]).toArray()
            : await db.runs.where('profile').equals(profile).toArray();
      return rows
        .filter((row) => challenge === undefined || row.challenge === (challenge ?? undefined))
        .sort((a, b) => compareText(a.record.startedAt, b.record.startedAt) || a.seq - b.seq)
        .map((row) => row.record);
    },

    get: async (id) => {
      const row = typeof id === 'string' ? await db.runs.get({ id }) : undefined;
      return row?.profile === profile ? row.record : undefined;
    },
  };
};

/** The adult's marks for one round: at least one card, each a part in the content and whether the child named it. */
const checkCards = (cards: unknown, ctx: StoreContext): readonly CardMark[] => {
  if (!Array.isArray(cards) || cards.length === 0) throw refusal('A round of the card game has at least one card.');
  return cards.map((card: unknown, index) => {
    if (!isRecord(card) || typeof card.part !== 'string' || typeof card.named !== 'boolean') {
      throw refusal(`Card ${index} is not { part, named }.`);
    }
    if (!ctx.content.catalogue.parts.has(card.part)) throw refusal(`Card ${index} names '${card.part}', which is not a part in the content.`);
    return { part: card.part, named: card.named };
  });
};

export const cardGamesOf = (ctx: StoreContext, profile: ProfileId): CardGames => {
  const { db, now } = ctx;
  const list = async (): Promise<readonly CardGameResult[]> =>
    (await db.cardGames.where('profile').equals(profile).toArray())
      .sort((a, b) => compareText(a.result.playedAt, b.result.playedAt) || a.seq - b.seq)
      .map((row) => row.result);
  return {
    add: async (marks) => {
      const cards = checkCards(marks, ctx);
      const result: CardGameResult = { id: uuidV4(), profile, playedAt: now(), cards };
      await db.transaction('rw', [db.profiles, db.cardGames, db.changes], async () => {
        await requireProfile(ctx, profile);
        await db.cardGames.add({ id: result.id, profile, result });
        await recordChange(db, { collection: 'card-games', id: result.id, profile, updatedAt: result.playedAt, removed: false });
      });
      return result;
    },
    list,
    latest: async () => (await list()).at(-1),
  };
};
