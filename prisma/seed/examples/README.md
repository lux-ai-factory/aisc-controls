# Example checklists

Seventeen example checklists, twelve from AESIA and five from EUSAiR, with
their sources in `../sources.json`. They are for trying the controls app on one
project database. In AISC a project's checklists are the ones installed into it
from the project's catalogue in step 3 (Choose tests and checklists), so nothing
loads these examples automatically.

`npm run db:seed` (`prisma db seed`, which runs `prisma/seed.ts`) loads them into
the database that `DATABASE_URL` names:

```bash
DATABASE_URL='postgresql://.../project_<hex>?schema=controls' npm run db:seed
```

It first adds or updates the sources listed in `../sources.json`, then creates
one checklist per folder here, with its questions in file order.

## Layout

Each example is a folder:

```
prisma/seed/examples/
  <folder-slug>/
    meta.json
    questions.json
```

A folder without both files is skipped.

`meta.json`:

```json
{
  "title": "Accuracy_Checklist",
  "sourceName": "AESIA",
  "controlTopic": "Accuracy",
  "description": "Source: https://aesia.digital.gob.es/en/guides",
  "countryIds": ["ES"],
  "regulationIds": ["ai-act"]
}
```

`sourceName` names the source (from `../sources.json`, or made by the seed if
it is not there yet); `description` and `sourceUpdatedAt` (YYYY-MM-DD) are
optional.

`questions.json`:

```json
{
  "questions": [
    { "text": "...", "article": "Article 15", "category": "MG01 - Selection of accuracy metrics" }
  ]
}
```

`article` and `category` are optional.

## Exporting a checklist into a new example

```bash
DATABASE_URL='postgresql://.../project_<hex>?schema=controls' \
  npm run examples:export -- <checklistId> [folderSlug]
```

This runs `prisma/seed/export.ts`. It writes `meta.json` and `questions.json`
into a folder here, named `folderSlug` or, by default, after the checklist's
title.

## Seeding again

The seed skips a checklist whose title is already in the database. To load one
again, delete that checklist from the database first.
