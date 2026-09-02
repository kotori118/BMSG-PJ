/**
 * BMSG Universe shared configuration.
 * Existing databases are read-only unless a later feature explicitly enables a write path.
 */
const UNIVERSE_CONFIG = Object.freeze({
  CORE_DB_ID: '1-1AY6-BACOaGW3HIgYS0UjFMPSh-cjvYMMnJ_UYoRFY',
  PROFILE_CACHE_SECONDS: 300,
  SHEETS: Object.freeze({
    GROUPS: '01_Groups',
    MEMBERS: '02_Members',
    GROUP_MEMBERS: '04_GroupMembers',
    IMAGES: '09_Images'
  })
});
