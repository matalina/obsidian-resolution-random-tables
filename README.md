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

- **Name.** The heading, lower-cased with dashes: `## Wandering Mob` is `pick:wandering-mob`. If two notes use the same heading, name the note too: `pick:Floor 3#wandering-mob`. A note with only one table can be named by the note alone: `pick:Floor 3`.
- **Die.** Any dice expression: `d20`, `2d6`, `d%`, `1d4+1`. If the header isn't dice, the die is `1d` the highest number in the first column.
- **Rows.** A number (`6`), a range (`1-3`, `1–3`, `2 to 4`), or open-ended (`19+`, `≤3`, `3 or less`). `00` counts as 100. `nat 20` or `Natural 1` matches the die as rolled, before any modifier, and wins over every other row.
- **Extra columns** are kept, joined with a dash: `A rusty sword — 2 gp`. Add `.column` to take just one, by its header: `pick:loot.value`.
- **Labels.** A `(Name)` at the end of the first cell names the row: `| 1-2 (Near Miss) | … |`. A labelled row rolls to its label, or to the label and the column when you pick one: `Near Miss — You miss`. A cell that's only a dash counts as empty.
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

`task:4` rolls against a level you give when you write it. The DC is **base + level × step** (default 0 + level × 3, so `task:4` is DC 12). Set base 0 and step 1 to give the target number directly: `task:15` is DC 15.

A modifier after the level is added to the roll: `task:15 +3`, `task:15 -2`. It counts toward the DC, but `nat 20` and `nat 1` rows still look at the die alone.

## Degrees of success (Dungeon Crawler Carl)

Rows can also be written in words, counting from the target: `Beat target by 10+`, `Beat target by 0–9`, `Miss by 1–2`, `Miss by 3–9`, `Miss by 10+`. With a `(Label)` and `Natural 20` / `Natural 1` rows, a degrees-of-success table works as written:

```markdown
# Degrees of Success

| Result                                    | Attack   | Evade      | Non-Combat |
| ----------------------------------------- | -------- | ---------- | ---------- |
| **Natural 20 (Critical Hit)**             | …        | …          | …          |
| **Beat target by 10+ (Amazing Success)**  | …        | …          | …          |
| **Beat target by 0–9 (Standard Success)** | …        | …          | …          |
| **Miss by 1–2 (Near Miss)**               | …        | —          | …          |
| **Miss by 3–9 (Standard Fail)**           | You miss | You're hit | …          |
| **Miss by 10+ (Major Fail)**              | …        | …          | …          |
| **Natural 1 (Critical Fail)**             | …        | …          | …          |
```

With task base 0 and step 1:

- `task:15 +3 Degrees of Success` → `Standard Success ← _(task 15 · DC 15 · 1d20+3: 13+3 = 16)_`
- `task:15 +3 Degrees of Success.attack` → `Standard Fail — You miss ← _(…)_`

Set **Default task table** to `Degrees of Success`, and a plain `task:15 +3` uses it.

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
