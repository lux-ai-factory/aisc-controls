# Example checklists

Seventeen checklists (AESIA and EUSAiR), with their sources in
`../sources.json`. `prisma db seed` (`prisma/seed.ts`) loads them into the
database `DATABASE_URL` names. Nothing runs it automatically: in AISC a
project's checklists are the ones installed into it from the catalogue, so
these are for trying the app on one project database.

## Layout

Each example is a folder:

```
prisma/seed/examples/
  <folder-slug>/
    meta.json
    questions.json
```

`meta.json`:

```json
{
  "title": "AEPD: RGPD operational controls",
  "sourceName": "AEPD",
  "controlTopic": "Data protection",
  "description": "Spanish DPA reference checklist for RGPD operational controls.",
  "countryIds": ["ES"],
  "regulationIds": ["GDPR"]
}
```

`sourceName` names the source (from `../sources.json`, or made by the seed if
it is not there yet); `sourceUpdatedAt` (YYYY-MM-DD) is optional.

`questions.json`:

```json
{
  "questions": [
    { "text": "...", "article": "Art. 5.1.a", "category": "Lawfulness" }
  ]
}
```

## Exporting a checklist into a new example

```bash
DATABASE_URL='postgresql://.../project_<hex>?schema=controls' \
  npx tsx prisma/seed/export.ts <checklistId> [folderSlug]
```

It writes `meta.json` and `questions.json` into a new folder here.

## Seeding again

The seed skips a checklist whose title is already in the database. To load one
again, delete that checklist from the database first.
