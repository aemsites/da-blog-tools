# MSM Status Icons: Timestamp Noise

## Fundamental Issues

### 1. Publishing bumps `lastModified`

Publishing a page bumps its DA source `lastModified` after the publish timestamp is recorded:

```
previewTime:      n
liveTime:         n+1
editLastModified: n+2  ← bumped by publish
```

Because `editLastModified > liveTime`, the page immediately appears stale after every publish. This is structural — it happens on every publish regardless of content changes.

### 2. `outOfSync` has no sync history

`outOfSync` compares `satellite.lastModified` vs `base.lastModified`. This answers "is the base file newer than the satellite file?" — not "did the base content change since we last synced?" There is no record of when a sync happened, so the comparison can drift and produce false positives or false negatives as both files are edited and published over time.

## Current Workaround

A `PUBLISH_LAG_MS = 5000` tolerance is applied to all comparisons that involve `editLastModified` (`previewState`, `liveState`, `outOfSync`). Timestamps within 5s of each other are treated as equal, absorbing the publish-bump lag.

**What this fixes:** the 🟢🟡🔴 publish-status states are now reliable for normal workflows.  
**What this doesn't fix:** the 🟠🔴 `outOfSync` states remain timestamp-based with no sync history.  
**Risk:** a real content change made within 5s of a publish would be masked. Unlikely in practice since DA only auto-saves on content change.

## What's Needed to Fully Fix It

**Remove the workaround:** DA/AEM should not bump `lastModified` as a side effect of publishing. This is a platform-level fix — it cannot be addressed client-side. Once fixed, `PUBLISH_LAG_MS` can be removed.

**Fix `outOfSync` reliability:** store `baseLMAtSync` (the base's `lastModified` at the time of each sync) in a DA sidecar file or external MSM service. `outOfSync` then becomes `base.lastModified !== baseLMAtSync` — a reliable answer to "did the base change since we last synced?" rather than a timestamp drift comparison.
