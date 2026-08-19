/**
 * exercise-library.js
 * ---------------------------------------------------------------------------
 * Static reference data for the Workout module — mirrors the pattern used by
 * program-templates.js and food-database.js (pure data + pure lookups, no
 * storage access). Gives the "Add Exercise" picker and the Creator Workout
 * seed a shared, consistent set of exercise names instead of free text only
 * (a custom name is always still allowed).
 *
 * Every exercise carries a `location` tag ('gym' | 'home' | 'both') so the
 * picker can segregate gym-equipment moves from bodyweight/home-friendly
 * ones within the same muscle group, per the person's own setup.
 *
 * `videoId` is a YouTube video ID for a short form-demonstration clip.
 * Only exercises with a *verified* video (checked against a real, live
 * YouTube URL) carry one — this app never invents a video link for an
 * exercise it hasn't actually confirmed, the same rule it already follows
 * for nutrition and workout content. Everything else is `videoId: null`;
 * ExerciseVideo.resolve() falls back to a "no video yet — attach one"
 * state for those, rather than a fabricated ID that might 404 or show the
 * wrong movement entirely.
 * ---------------------------------------------------------------------------
 */

const ExerciseLibrary = (() => {

  const LOCATIONS = [
    { key: 'gym', label: 'Gym' },
    { key: 'home', label: 'Home' },
    { key: 'both', label: 'Either' },
  ];

  const MUSCLE_GROUPS = [
    {
      key: 'chest', label: 'Chest',
      exercises: [
        { name: 'Barbell Bench Press', type: 'compound', location: 'gym', videoId: 'gRVjAtPip0Y' },
        { name: 'Incline Barbell Press', type: 'compound', location: 'gym', videoId: 'O9x7xRhtA9Q' },
        { name: 'Decline Barbell Press', type: 'compound', location: 'gym', videoId: null },
        { name: 'Incline Dumbbell Press', type: 'compound', location: 'gym', videoId: 'sK4Rvug6ufo' },
        { name: 'Flat Dumbbell Press', type: 'compound', location: 'gym', videoId: null },
        { name: 'Dumbbell Chest Fly', type: 'isolation', location: 'gym', videoId: 'n7tC3xiaLzE' },
        { name: 'Cable Chest Fly', type: 'isolation', location: 'gym', videoId: 'ovFc-5YdcXw' },
        { name: 'Pec Deck Machine', type: 'isolation', location: 'gym', videoId: null },
        { name: 'Chest Press Machine', type: 'compound', location: 'gym', videoId: null },
        { name: 'Push-Up', type: 'compound', location: 'both', videoId: 'i9sTjhN4Z3M' },
        { name: 'Incline Push-Up', type: 'compound', location: 'home', videoId: null },
        { name: 'Decline Push-Up', type: 'compound', location: 'home', videoId: null },
        { name: 'Diamond Push-Up', type: 'compound', location: 'home', videoId: '8_ILkbB9an8' },
        { name: 'Wide Push-Up', type: 'compound', location: 'home', videoId: null },
        { name: 'Dips (Chest-Focused)', type: 'compound', location: 'gym', videoId: null },
        { name: 'Resistance Band Chest Press', type: 'compound', location: 'home', videoId: null },
        { name: 'Floor Chest Press (Dumbbell)', type: 'compound', location: 'home', videoId: null },
      ],
    },
    {
      key: 'back', label: 'Back',
      exercises: [
        { name: 'Deadlift', type: 'compound', location: 'gym', videoId: '8luF-t9o1AM' },
        { name: 'Romanian Deadlift', type: 'compound', location: 'gym', videoId: 'KN5vN3JskqI' },
        { name: 'Sumo Deadlift', type: 'compound', location: 'gym', videoId: null },
        { name: 'Lat Pulldown', type: 'compound', location: 'gym', videoId: 'EfvPfLOuC3Y' },
        { name: 'Close-Grip Lat Pulldown', type: 'compound', location: 'gym', videoId: null },
        { name: 'Seated Cable Row', type: 'compound', location: 'gym', videoId: 'OeLb503NZHk' },
        { name: 'Barbell Row', type: 'compound', location: 'gym', videoId: 'qXrTDQG1oUQ' },
        { name: 'Dumbbell Row', type: 'compound', location: 'gym', videoId: 'dgsvDdAOHIY' },
        { name: 'T-Bar Row', type: 'compound', location: 'gym', videoId: 'BbBR3v2UShw' },
        { name: 'Chest-Supported Row', type: 'compound', location: 'gym', videoId: null },
        { name: 'Pull-Up', type: 'compound', location: 'both', videoId: 'TMnxKjdYcME' },
        { name: 'Chin-Up', type: 'compound', location: 'both', videoId: 'liebDvbcdow' },
        { name: 'Assisted Pull-Up (Band)', type: 'compound', location: 'home', videoId: null },
        { name: 'Inverted Row (Bodyweight)', type: 'compound', location: 'home', videoId: 'dnpDUwqMX04' },
        { name: 'Resistance Band Row', type: 'compound', location: 'home', videoId: null },
        { name: 'Superman Hold', type: 'isolation', location: 'home', videoId: 'UXUGfiNL1lI' },
        { name: 'Back Extension', type: 'isolation', location: 'gym', videoId: 'gLT-WLH84B4' },
        { name: 'Straight-Arm Pulldown', type: 'isolation', location: 'gym', videoId: null },
      ],
    },
    {
      key: 'legs', label: 'Legs',
      exercises: [
        { name: 'Barbell Back Squat', type: 'compound', location: 'gym', videoId: 'Uv_DKDl7EjA' },
        { name: 'Barbell Front Squat', type: 'compound', location: 'gym', videoId: null },
        { name: 'Leg Press', type: 'compound', location: 'gym', videoId: '8nm863C0c60' },
        { name: 'Hack Squat', type: 'compound', location: 'gym', videoId: null },
        { name: 'Bulgarian Split Squat', type: 'compound', location: 'both', videoId: 'Z-SpFLXhf18' },
        { name: 'Walking Lunge', type: 'compound', location: 'both', videoId: 'BenhAbJiTsw' },
        { name: 'Reverse Lunge', type: 'compound', location: 'both', videoId: 'ALl174GTuoY' },
        { name: 'Step-Up', type: 'compound', location: 'both', videoId: 'CYgeBOmb5Vw' },
        { name: 'Leg Extension', type: 'isolation', location: 'gym', videoId: 'MXvSzXEBOTI' },
        { name: 'Leg Curl', type: 'isolation', location: 'gym', videoId: '3gZm9wGTsEo' },
        { name: 'Standing Calf Raise', type: 'isolation', location: 'both', videoId: 'ndQc4mz4mBU' },
        { name: 'Seated Calf Raise', type: 'isolation', location: 'gym', videoId: null },
        { name: 'Goblet Squat', type: 'compound', location: 'both', videoId: 'BR4tlEE_A98' },
        { name: 'Bodyweight Squat', type: 'compound', location: 'home', videoId: null },
        { name: 'Jump Squat', type: 'compound', location: 'home', videoId: null },
        { name: 'Wall Sit', type: 'isolation', location: 'home', videoId: 'JQ2JBphtUk8' },
        { name: 'Glute Bridge', type: 'isolation', location: 'home', videoId: 'L9KZfxT654Y' },
        { name: 'Single-Leg Glute Bridge', type: 'isolation', location: 'home', videoId: null },
        { name: 'Calf Raise (Bodyweight)', type: 'isolation', location: 'home', videoId: null },
        { name: 'Pistol Squat', type: 'compound', location: 'home', videoId: 'dr0fQWTx6S0' },
      ],
    },
    {
      key: 'glutes', label: 'Glutes',
      exercises: [
        { name: 'Barbell Hip Thrust', type: 'compound', location: 'gym', videoId: 'pF17m_CXfL0' },
        { name: 'Cable Kickback', type: 'isolation', location: 'gym', videoId: null },
        { name: 'Hip Abduction Machine', type: 'isolation', location: 'gym', videoId: null },
        { name: 'Glute Bridge (Bodyweight)', type: 'isolation', location: 'home', videoId: null },
        { name: 'Single-Leg Deadlift (Bodyweight)', type: 'compound', location: 'home', videoId: null },
        { name: 'Fire Hydrant', type: 'isolation', location: 'home', videoId: 'I8lTSGfVCRs' },
        { name: 'Donkey Kick', type: 'isolation', location: 'home', videoId: 'I8lTSGfVCRs' },
        { name: 'Clamshell', type: 'isolation', location: 'home', videoId: 'Cn09FlW5Zfs' },
        { name: 'Resistance Band Hip Thrust', type: 'compound', location: 'home', videoId: null },
      ],
    },
    {
      key: 'shoulders', label: 'Shoulders',
      exercises: [
        { name: 'Overhead Barbell Press', type: 'compound', location: 'gym', videoId: 'F3QY5vMz_6I' },
        { name: 'Dumbbell Shoulder Press', type: 'compound', location: 'both', videoId: 'fuQpuu--bMI' },
        { name: 'Arnold Press', type: 'compound', location: 'both', videoId: 'fFyrgCWTIaI' },
        { name: 'Machine Shoulder Press', type: 'compound', location: 'gym', videoId: null },
        { name: 'Lateral Raise', type: 'isolation', location: 'both', videoId: 'nnH63icHYXY' },
        { name: 'Cable Lateral Raise', type: 'isolation', location: 'gym', videoId: null },
        { name: 'Front Raise', type: 'isolation', location: 'both', videoId: 'CH9JzDStL3U' },
        { name: 'Rear Delt Fly', type: 'isolation', location: 'both', videoId: 'lPt0GqwaqEw' },
        { name: 'Face Pull', type: 'isolation', location: 'gym', videoId: '0Po47vvj9g4' },
        { name: 'Upright Row', type: 'compound', location: 'gym', videoId: 'jaAV-rD45I0' },
        { name: 'Pike Push-Up', type: 'compound', location: 'home', videoId: 'pHR5yG6xBps' },
        { name: 'Resistance Band Lateral Raise', type: 'isolation', location: 'home', videoId: null },
        { name: 'Resistance Band Shoulder Press', type: 'compound', location: 'home', videoId: null },
      ],
    },
    {
      key: 'arms', label: 'Arms (Biceps/Triceps)',
      exercises: [
        { name: 'Barbell Bicep Curl', type: 'isolation', location: 'gym', videoId: 'ykJmrZ5v0Oo' },
        { name: 'Dumbbell Bicep Curl', type: 'isolation', location: 'both', videoId: 'ykJmrZ5v0Oo' },
        { name: 'Hammer Curl', type: 'isolation', location: 'both', videoId: '4BRAf2BajWw' },
        { name: 'EZ Bar Bicep Curl', type: 'isolation', location: 'gym', videoId: null },
        { name: 'Preacher Curl', type: 'isolation', location: 'gym', videoId: 'gSsEC9O6NYU' },
        { name: 'Cable Bicep Curl', type: 'isolation', location: 'gym', videoId: null },
        { name: 'Concentration Curl', type: 'isolation', location: 'both', videoId: 'oPGBZHIxusU' },
        { name: 'Triceps Rope Pushdown', type: 'isolation', location: 'gym', videoId: 'd-ySLTHUgQA' },
        { name: 'Overhead Triceps Extension', type: 'isolation', location: 'both', videoId: 'DZgpCf5alfI' },
        { name: 'Skull Crusher', type: 'isolation', location: 'gym', videoId: 'tj81tVq3wLo' },
        { name: 'Triceps Dip', type: 'isolation', location: 'both', videoId: 'AE4xaqTICTA' },
        { name: 'Close-Grip Bench Press', type: 'compound', location: 'gym', videoId: null },
        { name: 'Bench Dip', type: 'isolation', location: 'home', videoId: null },
        { name: 'Resistance Band Curl', type: 'isolation', location: 'home', videoId: null },
        { name: 'Resistance Band Triceps Pushdown', type: 'isolation', location: 'home', videoId: null },
      ],
    },
    {
      key: 'abs_core', label: 'Abs / Core',
      exercises: [
        { name: 'Plank', type: 'isolation', location: 'both', videoId: 'mwlp75MS6Rg' },
        { name: 'Side Plank', type: 'isolation', location: 'both', videoId: 'iNbH7_edNI8' },
        { name: 'Hanging Leg Raise', type: 'isolation', location: 'gym', videoId: 'Pr1ieGZ5atk' },
        { name: 'Cable Crunch', type: 'isolation', location: 'gym', videoId: null },
        { name: 'Ab Wheel Rollout', type: 'isolation', location: 'both', videoId: null },
        { name: 'Crunch', type: 'isolation', location: 'home', videoId: 'tnZNcIqhGb0' },
        { name: 'Bicycle Crunch', type: 'isolation', location: 'home', videoId: 'kDPxFoCmb-w' },
        { name: 'Russian Twist', type: 'isolation', location: 'home', videoId: 'H4tMFJoyAd8' },
        { name: 'Mountain Climber', type: 'isolation', location: 'home', videoId: 'hq_0YlyfqGM' },
        { name: 'Leg Raise (Floor)', type: 'isolation', location: 'home', videoId: null },
        { name: 'Flutter Kicks', type: 'isolation', location: 'home', videoId: null },
        { name: 'Dead Bug', type: 'isolation', location: 'home', videoId: 'bxn9FBrt4-A' },
        { name: 'Sit-Up', type: 'isolation', location: 'home', videoId: 'fTxaDVXhMnw' },
        { name: 'V-Up', type: 'isolation', location: 'home', videoId: null },
      ],
    },
    {
      key: 'cardio', label: 'Cardio',
      exercises: [
        { name: 'Treadmill', type: 'cardio', location: 'gym', isCardio: true, videoId: 'aKfJJ1TuyE4' },
        { name: 'Stationary Bike', type: 'cardio', location: 'gym', isCardio: true, videoId: null },
        { name: 'Rowing Machine', type: 'cardio', location: 'gym', isCardio: true, videoId: '4zWu1yuJ0_g' },
        { name: 'Elliptical', type: 'cardio', location: 'gym', isCardio: true, videoId: 'sHMemwz_HPU' },
        { name: 'Stair Climber', type: 'cardio', location: 'gym', isCardio: true, videoId: null },
        { name: 'Jump Rope', type: 'cardio', location: 'both', isCardio: true, videoId: null },
        { name: 'Jumping Jacks', type: 'cardio', location: 'home', isCardio: true, videoId: 'uLVt6u15L98' },
        { name: 'Burpees', type: 'cardio', location: 'home', isCardio: true, videoId: 'fZx6nxKMq4E' },
        { name: 'High Knees', type: 'cardio', location: 'home', isCardio: true, videoId: 'OpN2Y712k6Y' },
        { name: 'Shadow Boxing', type: 'cardio', location: 'home', isCardio: true, videoId: null },
        { name: 'Brisk Walk', type: 'cardio', location: 'both', isCardio: true, videoId: null },
        { name: 'Outdoor Run', type: 'cardio', location: 'both', isCardio: true, videoId: null },
        { name: 'Stair Sprints', type: 'cardio', location: 'home', isCardio: true, videoId: null },
      ],
    },
    {
      key: 'mobility_recovery', label: 'Mobility / Recovery',
      exercises: [
        { name: 'Light Mobility / Stretching', type: 'isolation', location: 'both', videoId: null },
        { name: "Cat-Cow Stretch", type: 'isolation', location: 'home', videoId: null },
        { name: "World's Greatest Stretch", type: 'isolation', location: 'home', videoId: null },
        { name: 'Foam Rolling', type: 'isolation', location: 'both', videoId: null },
        { name: 'Hip Flexor Stretch', type: 'isolation', location: 'home', videoId: null },
        { name: 'Shoulder Dislocates (Band)', type: 'isolation', location: 'home', videoId: null },
        { name: 'Thoracic Spine Rotation', type: 'isolation', location: 'home', videoId: null },
        { name: 'Yoga Flow (Beginner)', type: 'isolation', location: 'home', videoId: null },
      ],
    },
  ];

  function findGroup(key) {
    return MUSCLE_GROUPS.find(g => g.key === key) || null;
  }
  function findExercise(groupKey, name) {
    const group = findGroup(groupKey);
    return group ? (group.exercises.find(e => e.name === name) || null) : null;
  }
  /** Looks an exercise up by name only, across every group — used when a
   *  session/template only stored the name (e.g. previous performance lookups). */
  function findByName(name) {
    for (const group of MUSCLE_GROUPS) {
      const match = group.exercises.find(e => e.name === name);
      if (match) return { ...match, muscleGroup: group.key };
    }
    return null;
  }
  /** Exercises within a muscle group, optionally narrowed to a location —
   *  'gym' returns gym + both, 'home' returns home + both, 'any'/'' returns
   *  everything. Used by the Add Exercise picker's "Where" filter. */
  function filterByLocation(groupKey, location) {
    const group = findGroup(groupKey);
    if (!group) return [];
    if (!location || location === 'any') return group.exercises;
    return group.exercises.filter(e => e.location === location || e.location === 'both');
  }

  return { MUSCLE_GROUPS, LOCATIONS, findGroup, findExercise, findByName, filterByLocation };
})();
