# Resolution and Random Tables example

Each command below rolls as soon as it renders, and the result replaces the code in the note, once.

## Try it

- Loot: `pick:loot`
- Loot from this note specifically: `pick:Resolution and Random Tables Example#loot`
- A creature: `pick:wandering-mob`
- Is anyone home? `oracle:`
- Is the door locked (likely)? `oracle:+`
- Is the boss asleep (very unlikely)? `oracle:--`
- Picking the lock, level 4: `task:4`
- Asking the door itself: `oracle:+ door`
- Disarming the trap with its own outcomes: `task:3 trap-outcome`

---

## Loot

| d6  | Item                     | Value |
| --- | ------------------------ | ----- |
| 1-3 | {2d6} copper coins       |       |
| 4-5 | A rusty sword            | 2 gp  |
| 6   | {gem} worth {2d6*10} gp  |       |

## Gem

| Gem      |
| -------- |
| Ruby     |
| Sapphire |
| Emerald  |
| Opal     |

## Wandering mob

| 2d6   | Mob                                |
| ----- | ---------------------------------- |
| 2-4   | {2d4} rat-kin with {gem} eyes      |
| 5-9   | A single, very confused goblin     |
| 10-12 | Something big. Run.                |

## Door

dc: 12
shift: 2

| d20       | Answer                          |
| --------- | ------------------------------- |
| 1         | Locked, barred, and trapped     |
| 2-DC-6    | Locked                          |
| DC-5–DC-1 | Stuck, but it'll give           |
| DC-DC+4   | Open                            |
| DC+5+     | Open, and something's left here |

## Trap outcome

step: 4

| d20       | Outcome                                  |
| --------- | ---------------------------------------- |
| 1         | It goes off in your hands                |
| 2-DC-6    | It goes off, but you're clear            |
| DC-5–DC-1 | Disarmed, but it's noisy                 |
| DC-DC+4   | Disarmed                                 |
| DC+5+     | Disarmed, and you keep the parts         |
