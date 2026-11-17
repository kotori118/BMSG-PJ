/** TEST-ONLY BRANCH: Never merge or deploy. BMSGDB library requires independent staging binding. */
/**
 * BMSG Universe shared configuration.
 */
const UNIVERSE_CONFIG = Object.freeze({
  CORE_DB_ID: '1VANjD182-JPIYkYJ6J-6FdqQ5d8nZXsX9iyIhIlfyPk',
  LOG_DB_ID: '1-j0QqCQKvSyMFSFifZ0hdNIuQ8cmfkRTuop1eGlj1Kk',
  CARD_IMAGE_FOLDER_ID: '1ayh-EAbV585JqRofClrTHjBxNTQlfQBK',
  PROFILE_CACHE_SECONDS: 300,
  USER_IDS: Object.freeze(['U001', 'U002', 'U003']),
  USER_DISPLAY_NAMES: Object.freeze({
    U001: 'ももたん', U002: 'みおたん', U003: 'りおたん'
  }),
  SHEETS: Object.freeze({
    GROUPS: '01_Groups', MEMBERS: '02_Members', GUESTS: '03_Guests',
    GROUP_MEMBERS: '04_GroupMembers', PROFILES: '05_Profiles', SONGS: '06_Songs', SONG_CREDITS: '07_SongCredits',
    LYRICS_PARTS: '08_LyricsParts', IMAGES: '09_Images', PERFORMANCE_METRICS: '10_PerformanceMetrics',
    PROFILE_SETTINGS: 'ProfileSettings', USERS: 'Users', ID_REGISTRY: 'IDRegistry',
    KARAOKE_ROOMS: 'KARAOKE_Rooms', KARAOKE_RESULTS: 'KARAOKE_ShuffleResults', KARAOKE_FAVORITES: 'KARAOKE_FavoriteSets',
    CARD_COLLECTIONS: 'CardCollections', USER_FAVORITES: 'UserFavorites', RECENT_ACTIVITIES: 'RecentActivities',
    POKER_ROOMS: 'PokerRooms', POKER_PLAYERS: 'PokerPlayers',
    POKER_VOTES: 'PokerVotes', POKER_HIGHLIGHTS: 'PokerHighlights',
    QUIZ_ROOMS: 'QuizRooms', QUIZ_QUESTIONS: 'QuizQuestions',
    QUIZ_RESULTS: 'QuizRoomResults', QUIZ_SCORES: 'QuizScores',
    COVER_PROJECTS: 'COVER_Projects', COVER_ASSIGNMENTS: 'COVER_Assignments',
    COVER_SOURCE_SNAPSHOTS: 'COVER_SourceSnapshots', COVER_PROJECT_MEMBERS: 'COVER_ProjectMembers'
  })
});
