import app, { TerritoryDB, RoomHub } from "./worker.js";

const RESET_KEY = "fresh_game_start_2026_10_01";
const initialState = () => ({
  currentChapter: 1,
  chapterStage: 1,
  chapterProgress: 0,
  chapterBossUnlocked: false,
  chapterBossDefeated: false,
  chapterCompleted: false,
  battleStones: 30,
  battleStonesBonus: 0,
  pve: { chapter: 1, stage: 1, progress: 0, bossPending: false, bossActive: false, wins: 0, bossDefeated: 0 },
  lootFound: 0,
  totalChaptersCompleted: 0,
  rewardProgress: {
    dailyDate: "",
    daily: { wins: 0, loot: 0, forge: 0, bosses: 0, chapters: 0 },
    weekly: { wins: 0, loot: 0, forge: 0, bosses: 0, chapters: 0 },
    dailyClaims: {}, weeklyClaims: {}, storyClaims: {}, achievementClaims: {}
  },
  forge: { materials: 0, successes: 0, failStreak: 0, selectedId: null },
  inventoryItems: [],
  equipment: [],
  consumables: {},
  followers: { activeFollower: "liabro", items: { liabro: { id: "liabro", owned: true, level: 1, xp: 0, awakened: false, awakeningClaimed: false } } },
  activeFollower: "liabro",
  arena: { rating: 1000, wins: 0, losses: 0, battles: 0 },
  story: { arc01: "awakening" },
  daily: {},
  weekly: {},
  achievementClaims: {},
  chapterRewardsClaimed: {},
  rewardClaims: {},
  npcRelations: {},
  npcInteractionLog: [],
  npcRewards: {},
  npcQuests: {},
  npcStories: {},
  npcStoryAftermath: {},
  npcEndings: {},
  worldUnlocks: {},
  worldLocationActions: {},
  worldLocationRewards: {},
  worldMemories: {},
  worldEchoes: {},
  worldConvergence: {},
  worldBranchEvents: {},
  worldPathFrontiers: {},
  worldFrontierAftermath: {},
  worldFinale: {},
  heroChronicle: {}
});

const originalUpsert = TerritoryDB.prototype.upsert;
TerritoryDB.prototype.upsert = function(user) {
  const player = originalUpsert.call(this, user);
  if (player && (!player.state_json || String(player.state_json) === "{}")) {
    this.sql.exec("UPDATE players SET state_json=?, updated_at=? WHERE telegram_id=?", JSON.stringify(initialState()), Math.floor(Date.now()/1000), String(user?.id ?? ""));
    return this.player(String(user?.id ?? ""));
  }
  return player;
};

TerritoryDB.prototype.freshGameResetOnce = async function() {
  this.init();
  const existing = this.sql.exec("SELECT value FROM territory_runtime_meta WHERE key=?", RESET_KEY).toArray()[0];
  if (existing) {
    const row = this.sql.exec("SELECT COUNT(*) AS total FROM players").toArray()[0] || {};
    return { ok: true, performed: false, players: Number(row.total || 0), reset: RESET_KEY };
  }

  const stateJson = JSON.stringify(initialState());
  let playerCount = 0;
  this.ctx.storage.transactionSync(() => {
    playerCount = Number(this.sql.exec("SELECT COUNT(*) AS total FROM players").toArray()[0]?.total || 0);

    for (const table of [
      "inventory", "player_mail", "daily_scores", "tournament_awards", "finance",
      "anti_cheat", "economy_ledger", "player_events", "arena_reward_claims",
      "pve_sessions", "mail_broadcasts"
    ]) this.sql.exec(`DELETE FROM ${table}`);

    this.sql.exec(`
      UPDATE players SET
        level=1,
        exp=0,
        hp=100,
        max_hp=100,
        coins=0,
        gems=0,
        red_gems=0,
        vip=0,
        strength=5,
        agility=5,
        defense=0,
        weapon='Кулаки',
        banned=0,
        ban_reason='',
        state_json=?,
        updated_at=?
    `, stateJson, Math.floor(Date.now()/1000));

    this.sql.exec("DELETE FROM admin_audit");
    this.sql.exec(
      "INSERT INTO territory_runtime_meta(key,value) VALUES(?,?)",
      RESET_KEY,
      JSON.stringify({ completedAt: new Date().toISOString(), players: playerCount, purpose: "single fresh-game start" })
    );
  });

  return { ok: true, performed: true, players: playerCount, reset: RESET_KEY };
};

export { TerritoryDB, RoomHub };

export default {
  async fetch(request, env, ctx) {
    try {
      const stub = env.DB.get(env.DB.idFromName("global"));
      await stub.freshGameResetOnce();
    } catch (e) {
      console.error("fresh-game-reset-once failed", e);
      return new Response(JSON.stringify({ ok: false, error: "Fresh game initialization failed" }), {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      });
    }
    return app.fetch(request, env, ctx);
  }
};
