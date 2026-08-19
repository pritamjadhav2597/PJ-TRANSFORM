/**
 * exercise-video.js
 * ---------------------------------------------------------------------------
 * Resolves a demo video for any exercise by name — first checking
 * ExerciseLibrary's own verified `videoId` (see that file's doc comment on
 * why only some exercises ship with one), then falling back to whatever the
 * person has attached themselves via DataService.exerciseVideos. This is
 * what makes the video system work for every exercise "already added to the
 * app and going to be added" per spec: custom-named exercises typed into
 * the picker get exactly the same attach-a-video path as library ones.
 * ---------------------------------------------------------------------------
 */

const ExerciseVideo = (() => {

  function normalizeKey(name) {
    return (name || '').trim().toLowerCase();
  }

  /** Pulls a YouTube video ID out of any of the URL shapes people actually
   *  paste (watch?v=, youtu.be/, /embed/, shorts/), or returns the input
   *  unchanged if it already looks like a bare 11-character ID. Returns
   *  null if nothing recognizable was found — callers should keep the raw
   *  url as a fallback link rather than trying to embed a bad ID. */
  function extractYouTubeId(input) {
    if (!input) return null;
    const str = input.trim();
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    ];
    for (const re of patterns) {
      const m = str.match(re);
      if (m) return m[1];
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(str)) return str;
    return null;
  }

  function buildEmbedUrl(videoId) {
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
  }

  function buildSearchUrl(exerciseName) {
    const q = encodeURIComponent(`${exerciseName} exercise proper form`);
    return `https://www.youtube.com/results?search_query=${q}`;
  }

  /** Looks up a video for the given exercise name: library-verified first,
   *  then any custom one the person previously attached. Returns
   *  { videoId, source: 'library'|'custom' } or null if neither exists. */
  async function resolve(exerciseName) {
    const libEntry = ExerciseLibrary.findByName(exerciseName);
    if (libEntry && libEntry.videoId) {
      return { videoId: libEntry.videoId, source: 'library' };
    }
    const key = normalizeKey(exerciseName);
    if (!key) return null;
    const rows = await DataService.exerciseVideos.list(v => v.exerciseKey === key);
    const custom = rows[0];
    if (custom && custom.videoId) {
      return { videoId: custom.videoId, source: 'custom' };
    }
    return null;
  }

  /** Saves (or replaces) the person's own attached video for an exercise
   *  name. Accepts a full YouTube URL or a bare video ID. Returns the
   *  saved videoId, or null if the input wasn't a recognizable YouTube link. */
  async function saveCustom(exerciseName, rawInput) {
    const videoId = extractYouTubeId(rawInput);
    if (!videoId) return null;
    const key = normalizeKey(exerciseName);
    const existing = (await DataService.exerciseVideos.list(v => v.exerciseKey === key))[0];
    if (existing) {
      await DataService.exerciseVideos.update(existing.exerciseVideoId, { videoId, url: rawInput.trim() });
    } else {
      await DataService.exerciseVideos.create(Models.createExerciseVideo(key, {
        exerciseName, videoId, url: rawInput.trim(),
      }));
    }
    return videoId;
  }

  return { normalizeKey, extractYouTubeId, buildEmbedUrl, buildSearchUrl, resolve, saveCustom };
})();
