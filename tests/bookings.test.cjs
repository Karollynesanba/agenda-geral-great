const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function stores(client) {
  const storage = new Map();
  let failWrites = false;
  const context = vm.createContext({
    window: { supabase: { createClient: () => client } },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => { if (failWrites) throw new Error("Storage full"); storage.set(key, value); },
    },
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  vm.runInContext(source.slice(0, source.indexOf("const cfg =")), context);
  return { ...vm.runInContext("({ localStore, supabaseStore })", context), failWrites: () => { failWrites = true; } };
}

const original = { day: "2099-10-15", start_time: "09:00", end_time: "10:00", name: "João Silva", sector: "operacional", topic: "Planejamento", participants: ["Maria"] };

test("edits retain the ID and persist across new storage instances", async () => {
  const environment = stores();
  const first = environment.localStore();
  assert.equal(await first.create(original), "ok");
  const [booking] = await first.list(original.day, original.day);
  const updated = { ...original, day: "2099-10-16", start_time: "23:30", end_time: "23:59", topic: "Revisão", participants: ["Ana"] };
  assert.equal(await first.update(booking.id, " joao   silva ", updated), "ok");
  const reloaded = environment.localStore();
  assert.equal((await reloaded.list(original.day, original.day)).length, 0);
  const [saved] = await reloaded.list(updated.day, updated.day);
  assert.equal(saved.id, booking.id);
  assert.equal(saved.topic, "Revisão");
  assert.equal(saved.start_time, "23:30");
  assert.equal(saved.end_time, "23:59");
  assert.deepEqual([...saved.participants], ["Ana"]);
});

test("participants can edit, but a new participant cannot authorize their own addition", async () => {
  const store = stores().localStore();
  await store.create(original);
  const [booking] = await store.list(original.day, original.day);
  assert.equal(await store.update(booking.id, "Ana", { ...original, participants: ["Ana"] }), "denied");
  assert.equal(await store.update(booking.id, "maria", { ...original, topic: "Atualizado" }), "ok");
});

test("overlapping edits fail without changing either meeting; adjacent edits succeed", async () => {
  const store = stores().localStore();
  await store.create(original);
  await store.create({ ...original, name: "Outro", start_time: "10:00", end_time: "11:00" });
  const before = await store.list(original.day, original.day);
  assert.equal(await store.update(before[0].id, "Maria", { ...original, end_time: "10:30" }), "taken");
  assert.equal(JSON.stringify(await store.list(original.day, original.day)), JSON.stringify(before));
  assert.equal(await store.update(before[0].id, "Maria", { ...original, start_time: "09:30" }), "ok");
});

test("deleted and ended meetings cannot be edited", async () => {
  const store = stores().localStore();
  assert.equal(await store.update("missing", "Maria", original), "missing");
  await store.create({ ...original, day: "2000-01-01" });
  const [booking] = await store.list("2000-01-01", "2000-01-01");
  assert.equal(await store.update(booking.id, "Maria", original), "ended");
});

test("storage write failures never report a successful edit", async () => {
  const environment = stores();
  const store = environment.localStore();
  await store.create(original);
  const [booking] = await store.list(original.day, original.day);
  environment.failWrites();
  assert.equal(await store.update(booking.id, "Maria", { ...original, topic: "Não salvo" }), "error");
  assert.equal((await store.list(original.day, original.day))[0].topic, original.topic);
});

test("Supabase edits use the existing ID, original actor and all changed fields", async () => {
  let called;
  const client = { rpc: async (name, args) => { called = { name, args }; return { data: "ok", error: null }; } };
  const store = stores(client).supabaseStore("url", "key");
  assert.equal(await store.update("booking-id", "Maria", original), "ok");
  assert.equal(called.name, "edit_booking");
  assert.equal(called.args.p_id, "booking-id");
  assert.equal(called.args.p_actor, "Maria");
  assert.equal(called.args.p_day, original.day);
  assert.equal(called.args.p_start, original.start_time);
  assert.equal(called.args.p_end, original.end_time);
  assert.equal(called.args.p_name, original.name);
  assert.equal(called.args.p_sector, original.sector);
  assert.equal(called.args.p_topic, original.topic);
  assert.deepEqual(called.args.p_participants, original.participants);
});

test("Supabase errors distinguish missing migration, conflicts, denial and network failures", async () => {
  const cases = [
    [{ error: { code: "PGRST202" } }, "setup"],
    [{ error: { code: "23P01" } }, "taken"],
    [{ data: "denied", error: null }, "denied"],
    [{ error: { code: "NETWORK" } }, "error"],
  ];
  for (const [response, expected] of cases) {
    const store = stores({ rpc: async () => response }).supabaseStore("url", "key");
    assert.equal(await store.update("id", "Maria", original), expected);
  }
});
