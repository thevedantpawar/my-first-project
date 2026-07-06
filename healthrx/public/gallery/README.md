# Gallery images

Drop the real HealthRx / SyncRx photos here using these exact filenames — the
site (the `#gallery` "Step inside HealthRx" section) picks them up automatically.
Until a file exists, a branded placeholder tile is shown in its place.

| Filename         | What it should be                                  |
| ---------------- | -------------------------------------------------- |
| `exterior.jpg`   | The black exterior of the building with HealthRx signage |
| `reception.jpg`  | Reception with the marble/rock desk + lounge       |
| `arrival.jpg`    | The archway corridor with the light-halo statue    |
| `floor.jpg`      | The main strength / training floor                 |
| `studio.jpg`     | The SyncRx yoga & recovery studio                  |

## Tips

- Use `.jpg` (or update the `src` names in `lib/site.ts` to match your files).
- Landscape shots ~1600×1000px look best; the exterior/studio tiles are wide,
  the reception tile is tall.
- Keep each file under ~400 KB for fast loads (export at ~80% quality).

To change the captions, tags, or which tile is wide/tall, edit the `gallery`
array in [`lib/site.ts`](../../lib/site.ts).
