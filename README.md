# Resolution and Random Tables

Roll on random tables you keep in your own notes, ask the oracle, and roll tasks against a level, all from inline code. Each command rolls **once**, as soon as it renders (in Live Preview, once the cursor is off it), and the result is written into the note in place of the code. Nothing rerolls.

```markdown
Loot: `pick:loot`
Is the door locked? `oracle:+`
Picking the lock: `task:4`
```

becomes:

```markdown
Loot: A rusty sword — 2 gp ← _(d6: 4)_
Is the door locked? Yes, but ← _(oracle likely · DC 12 · 1d20: 10)_
Picking the lock: Success ← _(task 4 · DC 12 · 1d20: 14)_
```

## Writing tables

A table is any markdown table with a heading directly above it. The first header cell is the die, and the first column says which rolls give each row:

```markdown
## Loot

| d6  | Item                    | Value |
| --- | ----------------------- | ----- |
| 1-3 | {2d6} copper coins      |       |
| 4-5 | A rusty sword           | 2 gp  |
| 6   | {gem} worth {2d6*10} gp |       |
```

- **Name.** The heading, lower-cased with dashes: `## Wandering Mob` is `pick:wandering-mob`. If two notes use the same heading, name the note too: `pick:Floor 3#wandering-mob`.
- **Die.** Any dice expression: `d20`, `2d6`, `d%`, `1d4+1`. If the header isn't dice, the die is `1d` the highest number in the first column.
- **Rows.** A number (`6`), a range (`1-3`, `1–3`, `2 to 4`), or open-ended (`19+`). `00` counts as 100.
- **Extra columns** are kept, joined with a dash: `A rusty sword — 2 gp`.
- **Nesting.** `{gem}` rolls another table, and `{2d6*10}` rolls dice. A nested table can be named by note too: `{Treasure#gem}`.
- **Plain lists.** If the first column isn't numbers, every row is equally likely:

```markdown
## Gem

| Gem      |
| -------- |
| Ruby     |
| Sapphire |
```

Tables are read from the whole vault by default, or only from one folder if you set **Tables folder**. Edits take effect as soon as Obsidian re-indexes the note, with no reload needed.

## Oracle

`oracle:` asks a yes/no question. It rolls the die (default `1d20`) against the oracle DC (default 15):

| Code                    | Likelihood    | DC |
| ----------------------- | ------------- | -- |
| `oracle:++`             | very likely   | 9  |
| `oracle:+`              | likely        | 12 |
| `oracle:`               | 50/50         | 15 |
| `oracle:-`              | unlikely      | 18 |
| `oracle:--`             | very unlikely | 21 |

## Task

`task:4` rolls against a level you give when you write it. The DC is **base + level × step** (default 0 + level × 3, so `task:4` is DC 12).

## Results

Without a results table, both use five bands counted from the DC:

| Roll         | Oracle   | Task          |
| ------------ | -------- | ------------- |
| 1            | No, and  | Fail, and     |
| 2 to DC-6    | No, but  | Fail, but     |
| DC-5 to DC-1 | Yes, but | Success, but  |
| DC to DC+4   | Yes      | Success       |
| DC+5 and up  | Yes, and | Success, and  |

### Your own results table

Put a table name after the oracle's likelihood or the task's level: `oracle:+ door`, `task:3 trap-outcome`. Its rows can count from the DC, so they move with the likelihood or level:

```markdown
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
```

Lines between the heading and the table override the settings for that table only:

| Line       | Overrides                                        |
| ---------- | ------------------------------------------------ |
| `dc: 12`   | the oracle's 50/50 DC                            |
| `shift: 2` | how far each `+` or `-` moves the oracle DC      |
| `base: 0`  | the task DC at level 0                           |
| `step: 4`  | how much each task level adds to the DC          |

The die in the table's header replaces the default die. A roll past either end of a DC table lands on its first or last row.

If you set **Default oracle table** or **Default task table**, plain `oracle:` and `task:4` use your table instead of the built-in bands.

A table that counts from the DC only works with `oracle:` and `task:`. `pick:` and `{nesting}` refuse it, because there's no DC to count from.

## In the editor

- **Autocomplete.** Typing `pick:`, `oracle:+ ` or `task:4 ` suggests table names.
- **Errors.** A command that can't roll stays as code with a red wavy underline, for example because the table isn't found or a name is in two notes. Hover it to see why. It rolls by itself once you fix the table.
- **Reload tables** (command palette) re-reads every note, if something looks stale.
- Turn off **Show the roll** to write only the result, without the italic note.

## Development

```bash
npm install
npm run dev        # watch build
npm test           # unit tests for the dice, tables and rolling engine
npm run lint
npm run test:vault # build, then copy into the vault named in .env
```
