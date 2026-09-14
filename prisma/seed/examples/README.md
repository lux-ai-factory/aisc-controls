# Bundled checklist examples

Anything in this folder is committed to git and replayed by `prisma db seed` so a
fresh clone has data to look at without uploading anything by hand.

## Layout

Each example is a folder:

```
prisma/seed/examples/
  aepd-rgpd-controls/
    meta.json
    questions.json
```

`meta.json`:

```json
{
  "title": "AEPD — RGPD operational controls",
  "sourceName": "AEPD",
  "controlTopic": "Data protection",
  "description": "Spanish DPA reference checklist for RGPD operational controls.",
  "countryIds": ["ES"],
  "regulationIds": ["GDPR"]
}
```

`questions.json`:

```json
{
  "questions": [
    { "text": "...", "article": "Art. 5.1.a", "category": "Lawfulness" }
  ]
}
```

## Adding an example you created in the UI

Run the export helper after you've added a checklist in the app:

```bash
npx tsx prisma/seed/export.ts <checklistId> [folderSlug]
```

It writes `meta.json` + `questions.json` into a new folder here; commit the
folder and the checklist seeds on the next fresh clone.

## Re-seeding

The seed is idempotent — it skips entries whose title already exists for the
system user. To force a re-seed of one entry, delete that checklist in the
DB first.
