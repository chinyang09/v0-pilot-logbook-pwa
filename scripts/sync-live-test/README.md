# Live multi-device sync test

Two or three "devices" — separate Chromium profiles, each with its own cookies
and IndexedDB — signed in as the same pilot, driving the real app UI against a
real MongoDB. It is what found the bugs the unit suites could not: the trigger
gating, the stale-device overwrite, the 26-second airport-seed stall, the
logout data loss.

It is NOT part of the app build or `pnpm test`, and it has its own
`package.json` so nothing here touches the root lockfile.

## Run

1. A MongoDB **replica set** (the engine uses transactions). For example, with
   a `mongod` binary:

   ```sh
   mongod --replSet rs0 --dbpath /tmp/mongo-data --port 27017 --bind_ip 127.0.0.1 --fork --logpath /tmp/mongod.log
   mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
   ```

2. The app, built and pointed at it:

   ```sh
   pnpm build
   MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" pnpm start -p 3100
   ```

3. The scenarios (this WIPES the `skylog` database — it refuses a non-local URI):

   ```sh
   cd scripts/sync-live-test && npm install
   CHROMIUM_PATH=/path/to/chrome BASE=http://localhost:3100 node scenarios.mjs
   CHROMIUM_PATH=/path/to/chrome BASE=http://localhost:3100 node logout.mjs
   ```

Sessions are seeded straight into MongoDB and the IndexedDB session mirror, so
no passkey ceremony is needed. Service workers are blocked for determinism.

## What it checks

| | |
|---|---|
| S1–S2 | an edit on one device reaches an idle other device, both ways |
| S3 | a STALE device (offline while the other edited) edits a different field — both edits survive, nothing reverted |
| S4 | the SAME field edited on both — the later edit wins, the loser is in `syncConflicts`, both converge |
| S5 | an offline edit is pushed within a second of reconnecting |
| S6 | a brand-new device has everything on its first sync |
| S7 | every stored flight document has the same keys |
| S8 | a second tab on one device shows the first tab's edit without a reload |
| logout | signing out with an unsynced edit asks first; cancelling keeps it |
