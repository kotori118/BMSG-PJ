import { emptyDataset, type Song, type Dataset } from "../shared/model.js";
// Public sample only. No attendance, seats, notes or full private Sheets snapshot.
// Research evidence and known omissions are in docs/TRIAL_DATA.md, outside the app schema.
const tracks: [string, string][] = [
  ["1003", "Gifted."],
  ["1023", "Mainstream"],
  ["1014", "Move On"],
  ["1011", "Milli-Billi"],
  ["1019", "Boom Boom Back"],
  ["1015", "Be Free"],
  ["1004", "First Step"],
  ["1012", "Moment"],
  ["1017", "Softly"],
  ["1025", "SOS"],
  ["1005", "Don't Wake Me Up"],
  ["1018", "Spin!"],
  ["1022", "Salvia"],
  ["1024", "Grow Up"],
  ["1020", "Smile again"],
  ["1001", "Shining One"],
  ["local-to-the-first", "To The First"],
  ["1016", "BF is..."],
  ["1006", "Brave Generation"],
  ["1027", "Set Sail"],
  ["1008", "Betrayal Game"],
  ["1009", "Scream"],
  ["1013", "Grateful Pain"],
  ["1002", "Kick Start"],
  ["1021", "Great Mistakes"],
  ["1007", "Bye-Good-Bye"],
  ["1026", "Glorious"],
  ["1010", "Message"],
  ["1028", "Masterplan"],
];
export const trialSongs: Song[] = tracks
  .filter(([id]) => !id.startsWith("local"))
  .map(([id, title]) => ({
    ref: "U:" + id,
    title,
    artist: "BE:FIRST",
    releaseDate: null,
    form: null,
    cdTitle: null,
    isTitleTrack: false,
    available: true,
  }));
export function trialDataset(): Dataset {
  const data = emptyDataset(),
    tourId = "dome-2024";
  data.tours = [
    {
      id: tourId,
      revision: 0,
      name: "Mainstream – Masterplan",
      type: "TOUR",
      startDate: "2024-03-02",
      endDate: "2024-04-21",
      defaultTime: "17:00",
      releaseIds: [],
    },
  ];
  data.shows = [
    ["2024-03-02", "東京ドーム", "東京"],
    ["2024-03-03", "東京ドーム", "東京"],
    ["2024-04-20", "京セラドーム大阪", "大阪"],
    ["2024-04-21", "京セラドーム大阪", "大阪"],
  ].map(([date, venue, region]) => ({
    id: "dome-" + date,
    revision: 0,
    tourId,
    name: "BE:FIRST LIVE in DOME 2024",
    type: "TOUR",
    format: "DOME",
    date,
    venue,
    region,
    slot: "夜",
    startsAt: date + "T17:00:00+09:00",
    templateId: date === "2024-03-03" ? "tokyo-0303" : null,
    hasSavedSetlist: date === "2024-03-03",
    surpriseReview: "UNREVIEWED",
    note: "",
  }));
  data.localSongs = [
    {
      id: "local-to-the-first",
      revision: 0,
      title: "To The First",
      artist: "SKY-HI",
    },
  ];
  data.songMetadata = [
    {
      id: "to-the-first",
      revision: 0,
      songRef: "L:local-to-the-first",
      category: "COVER",
      unreleased: false,
      announcedAt: null,
      appleMusicUrl: null,
    },
  ];
  data.templates = [
    {
      id: "tokyo-0303",
      revision: 0,
      tourId,
      name: "東京 3/3",
      entries: tracks.map(([id], i) => ({
        id: "entry-" + String(i + 1).padStart(2, "0"),
        songRef: id.startsWith("local") ? "L:" + id : "U:" + id,
        section: i === 28 ? "ENCORE" : "MAIN",
        version: "FULL",
        medleyGroup: null,
        performance: id.startsWith("local") ? "COVER" : "ORIGINAL",
        members: [],
      })),
    },
  ];
  return data;
}
