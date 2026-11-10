import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { onAuthStateChanged } from "firebase/auth";
import {
  House,
  Disc3,
  Ticket,
  ChartNoAxesCombined,
  Settings,
  ArrowLeft,
  Check,
  LogOut,
  Download,
  Upload,
  RefreshCw,
  Pencil,
  X,
} from "lucide-react";
import {
  auth,
  configured,
  login,
  logout,
  invoke,
  watchState,
  type State,
} from "./firebase";
import {
  effectiveEntries,
  analyze,
  unheard,
  parseBackup,
  exportJson,
  validateDataset,
  deriveOverrides,
} from "../shared/domain";
import { mergeCandidates } from "../shared/universe";
import {
  type Dataset,
  type Entry,
  type Show,
  type Collection,
  type Song,
} from "../shared/model";
import { trialDataset, trialSongs } from "../fixtures/dome2024";
import "./styles.css";
import { LibraryEditor, EntryEditor } from "./LibraryEditor";

const preview = import.meta.env.VITE_PREVIEW === "true";
const fixture: State = {
  control: { activeDatasetId: "preview", previousDatasetId: null, revision: 0 },
  data: trialDataset(),
  songs: trialSongs,
  syncedAt: null,
};
type Tab = "HOME" | "LIVE" | "MY LIVE" | "ANALYSIS" | "SETTINGS";
const tabs = [
  ["HOME", House],
  ["LIVE", Disc3],
  ["MY LIVE", Ticket],
  ["ANALYSIS", ChartNoAxesCombined],
] as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const copy = <T,>(v: T) => structuredClone(v);
function App() {
  const [state, setState] = useState<State | null>(preview ? fixture : null),
    [tab, setTab] = useState<Tab>("HOME"),
    [showId, setShowId] = useState<string | null>(null),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState("mine"),
    [year, setYear] = useState(""),
    [format, setFormat] = useState(""),
    [tourFilter, setTourFilter] = useState(""),
    [artist, setArtist] = useState(""),
    [category, setCategory] = useState(""),
    [expanded, setExpanded] = useState<string | null>(
      sessionStorage.getItem("lastTour"),
    ),
    [edit, setEdit] = useState<{
      show: Show;
      entries: Entry[];
      seat: string;
      note: string;
      facts: Dataset["entryFacts"];
    } | null>(null),
    [backup, setBackup] = useState<Dataset | null>(null),
    [libraryDirty, setLibraryDirty] = useState(false),
    [draftConflicted, setDraftConflicted] = useState(false);
  const stateRef = useRef(state),
    stop = useRef<() => void>(() => {}),
    generation = useRef(0),
    refreshSeq = useRef(0),
    baseline = useRef<State | null>(null),
    libraryBase = useRef<State | null>(null);
  stateRef.current = state;
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!auth || preview) return;
    return onAuthStateChanged(auth, async (user) => {
      stop.current();
      generation.current++;
      const gen = generation.current;
      setState(null);
      setEdit(null);
      if (!user) return;
      setBusy(true);
      setError("");
      const refresh = async () => {
        const seq = ++refreshSeq.current;
        try {
          const next = await invoke<State>("getState");
          if (gen === generation.current && seq === refreshSeq.current) {
            setState(next);
            if (
              baseline.current &&
              baseline.current.control.revision !== next.control.revision
            )
              setDraftConflicted(true);
          }
        } catch (e) {
          if (gen === generation.current) setError(message(e));
        }
      };
      try {
        await invoke("bootstrap");
        if (gen !== generation.current) return;
        stop.current = watchState(
          user.uid,
          () => void refresh(),
          (e) => setError(e.message),
        );
        await refresh();
        try {
          await invoke("syncUniverse");
          if (gen === generation.current) {
            setSyncError("");
            await refresh();
          }
        } catch (e) {
          if (gen === generation.current)
            setSyncError(
              "楽曲を同期できませんでした。同期済みのデータがある場合は前回値を表示します。" +
                message(e),
            );
        }
      } catch (e) {
        setError(message(e));
      } finally {
        if (gen === generation.current) setBusy(false);
      }
    });
  }, []);
  useEffect(() => () => stop.current(), []);
  const dirty = !!edit || libraryDirty;
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", guard);
    const back = () => {
      if (
        dirty &&
        !window.confirm("保存していない変更があります。破棄しますか？")
      ) {
        history.pushState(null, "");
        return;
      }
      setEdit(null);
      setLibraryDirty(false);
      setShowId(null);
      setTab("HOME");
    };
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("popstate", back);
    };
  }, [dirty]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const navigate = (next: Tab) => {
    if (busy) return;
    if (dirty && !confirm("保存していない変更があります。破棄しますか？"))
      return;
    setEdit(null);
    setLibraryDirty(false);
    setShowId(null);
    setTab(next);
  };
  const refresh = async () => {
    if (!preview) setState(await invoke<State>("getState"));
  };
  const save = async (
    collection: Collection,
    entity: { id: string; revision: number },
    baseState = stateRef.current,
  ) => {
    if (!baseState) throw new Error("データを読み込んでください");
    const existing = baseState.data[collection].find((x) => x.id === entity.id);
    if (preview) {
      const next = copy(stateRef.current!);
      (next.data[collection] as unknown[]) = [
        ...next.data[collection].filter((x) => x.id !== entity.id),
        { ...entity, revision: (existing?.revision ?? -1) + 1 },
      ];
      validateDataset(next.data);
      next.control.revision++;
      setState(next);
      return;
    }
    await invoke("saveEntity", {
      collection,
      entity,
      expectedEntityRevision: existing?.revision ?? null,
      expected: {
        datasetId: baseState.control.activeDatasetId,
        revision: baseState.control.revision,
      },
    });
    await refresh();
  };
  const atomicSave = async (
    data: Dataset,
    baseState: State,
    deletedShowIds: string[] = [],
  ) => {
    validateDataset(data);
    if (preview) {
      setState({
        ...stateRef.current!,
        data,
        control: {
          ...baseState.control,
          revision: baseState.control.revision + 1,
        },
      });
      return;
    }
    await invoke("saveDatasetChanges", {
      data,
      expected: {
        datasetId: baseState.control.activeDatasetId,
        revision: baseState.control.revision,
      },
      confirmedDeletedShowIds: deletedShowIds,
    });
    await refresh();
  };
  const attend = (show: Show) =>
    void run(async () => {
      if (!state) return;
      const current = state.data.attendance.find((x) => x.showId === show.id);
      const now = new Date().toISOString();
      await save("attendance", {
        id: show.id,
        revision: current?.revision ?? 0,
        showId: show.id,
        attended: !current?.attended,
        seat: current?.seat ?? "",
        note: current?.note ?? "",
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      } as Dataset["attendance"][number]);
    });
  const download = (name: string, text: string, type = "application/json") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const startEdit = (show: Show) => {
    if (!state) return;
    baseline.current = copy(state);
    setDraftConflicted(false);
    const a = state.data.attendance.find((x) => x.showId === show.id);
    setEdit({
      show: copy(show),
      entries: copy(effectiveEntries(state.data, show) ?? []),
      seat: a?.seat ?? "",
      note: a?.note ?? "",
      facts: copy(state.data.entryFacts.filter((f) => f.showId === show.id)),
    });
  };
  const saveEdit = () =>
    void run(async () => {
      if (!state || !edit || !baseline.current) return;
      if (draftConflicted)
        throw new Error(
          "他の端末の変更があります。「最新を読み直す」で保存する内容を確認してください",
        );
      const data = copy(baseline.current.data),
        s = edit.show,
        entries = edit.entries;
      if(s.tourId && !s.templateId) throw new Error("ツアー公演では基本セトリを選択してください。設定の「公演・基本セトリ」から作成できます");
      data.entryFacts = [
        ...data.entryFacts.filter((f) => f.showId !== s.id),
        ...edit.facts,
      ];
      const orphanFacts = data.entryFacts.filter(
        (f) => f.showId === s.id && !entries.some((e) => e.id === f.entryKey),
      );
      if (
        orphanFacts.length &&
        !confirm("削除した曲に紐づく披露事実も削除しますか？")
      )
        return;
      data.entryFacts = data.entryFacts.filter(
        (f) => !orphanFacts.some((o) => o.id === f.id),
      );
      s.hasSavedSetlist = true;
      if (s.templateId) {
        const template = data.templates.find((t) => t.id === s.templateId)!;
        const ops = deriveOverrides(template.entries, entries);
        const o = data.overrides.find((o) => o.showId === s.id);
        data.overrides = data.overrides.filter((o) => o.showId !== s.id);
        data.overrides.push({
          id: s.id,
          revision: (o?.revision ?? -1) + 1,
          showId: s.id,
          templateId: s.templateId,
          operations: ops,
        });
      } else {
        const old = data.directEntries.find((x) => x.showId === s.id);
        data.directEntries = data.directEntries.filter(
          (x) => x.showId !== s.id,
        );
        data.directEntries.push({
          id: s.id,
          revision: (old?.revision ?? -1) + 1,
          showId: s.id,
          entries,
        });
      }
      data.shows = data.shows.map((x) =>
        x.id === s.id ? { ...s, revision: x.revision + 1 } : x,
      );
      const a = data.attendance.find((x) => x.showId === s.id);
      const now = new Date().toISOString();
      data.attendance = data.attendance.filter((x) => x.showId !== s.id);
      data.attendance.push({
        id: s.id,
        revision: (a?.revision ?? -1) + 1,
        showId: s.id,
        attended: a?.attended ?? false,
        seat: edit.seat,
        note: edit.note,
        createdAt: a?.createdAt ?? now,
        updatedAt: now,
      });
      await atomicSave(data, baseline.current);
      baseline.current = null;
      setEdit(null);
    });
  const allSongs: Song[] = state
    ? [
        ...state.songs,
        ...state.data.localSongs.map((s) => ({
          ref: "L:" + s.id,
          title: s.title,
          artist: s.artist,
          releaseDate: null,
          form: null,
          cdTitle: null,
          isTitleTrack: false,
          available: true,
        })),
      ]
    : [];
  const title = (ref: string) =>
    allSongs.find((s) => s.ref === ref)?.title ?? ref;
  if (!state)
    return (
      <div className="login">
        <div className="wordmark">
          BE:FIRST<span>LIVE ARCHIVE</span>
        </div>
        <div className="glass login-card">
          <Disc3 size={44} />
          <h1>LIVE ARCHIVE</h1>
          {configured ? (
            <button
              className="primary"
              onClick={() => void run(login)}
              disabled={busy}
            >
              Googleでログイン
            </button>
          ) : (
            <p>Firebaseの接続設定が必要です</p>
          )}
          {auth?.currentUser && (
            <>
              <p>ログインUID: {auth.currentUser.uid}</p>
              <button onClick={() => void run(logout)}>ログアウト</button>
            </>
          )}
          {busy && <p role="status">読み込み中…</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  const data = state.data,
    mine = data.shows.filter((s) =>
      data.attendance.some((a) => a.showId === s.id && a.attended),
    ),
    myStats = analyze(data, mine),
    heard = new Set(myStats.map((s) => s.songRef)),
    missing = unheard(state.songs, heard),
    latest = [...mine].sort((a, b) => b.date.localeCompare(a.date))[0],
    show = data.shows.find((s) => s.id === showId),
    shownShows = data.shows.filter(
      (s) =>
        (scope === "all" || mine.some((m) => m.id === s.id)) &&
        (!year || s.date.startsWith(year)) &&
        (!format || s.format === format) &&
        (!tourFilter || s.tourId === tourFilter),
    ),
    stats = analyze(data, shownShows).filter(
      (s) =>
        (!artist ||
          allSongs.find((x) => x.ref === s.songRef)?.artist === artist) &&
        (!category ||
          (category === "UNRELEASED"
            ? data.songMetadata.find((m) => m.songRef === s.songRef)?.unreleased
            : data.songMetadata.find((m) => m.songRef === s.songRef)
                ?.category === category ||
              (category === "ORIGINAL" &&
                s.songRef.startsWith("U:") &&
                !data.songMetadata.some((m) => m.songRef === s.songRef)))),
    ),
    searchShows = data.shows.filter((s) =>
      [
        s.date,
        s.venue,
        data.tours.find((t) => t.id === s.tourId)?.name ?? s.name,
      ].some((x) => x.toLowerCase().includes(query.toLowerCase())),
    );
  const openShow = (s: Show) => {
    history.pushState(null, "");
    setShowId(s.id);
  };
  const CheckIn = ({ s }: { s: Show }) => (
    <button
      className={
        "checkin " + (mine.some((m) => m.id === s.id) ? "selected" : "")
      }
      disabled={busy || !online}
      aria-label={`${s.date} ${s.venue}の参加を切り替える`}
      aria-pressed={mine.some((m) => m.id === s.id)}
      onClick={() => attend(s)}
    >
      <Check size={17} />
      {mine.some((m) => m.id === s.id) ? "参加済み" : "参加する"}
    </button>
  );
  const ShowCard = ({ s }: { s: Show }) => (
    <div className="show-row">
      <button className="show-open" onClick={() => openShow(s)}>
        <span className="eyebrow">
          {s.date.replaceAll("-", ".")} · {s.region}
        </span>
        <strong>{s.venue}</strong>
        <small>
          {s.hasSavedSetlist
            ? `${effectiveEntries(data, s)?.length}曲`
            : "セトリ未入力"}
        </small>
      </button>
      <CheckIn s={s} />
    </div>
  );
  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => navigate("HOME")}>
          BE:FIRST<span>LIVE ARCHIVE</span>
        </button>
        <button
          className="icon"
          aria-label="設定"
          onClick={() => navigate("SETTINGS")}
        >
          <Settings size={20} />
        </button>
      </header>
      {preview && (
        <div className="preview">試験表示 · 保存はこの画面内のみ</div>
      )}
      {!online && (
        <div className="error" role="alert">
          インターネットに接続してください。データ操作は停止しています。
        </div>
      )}
      {syncError && (
        <div className="error" role="alert">
          {syncError}
          <button
            onClick={() =>
              void run(async () => {
                await invoke("syncUniverse");
                setSyncError("");
                await refresh();
              })
            }
          >
            再同期
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="icon"
            aria-label="エラーを閉じる"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="loading" role="status">
          読み込み中…
        </div>
      )}
      <main>
        {edit ? (
          <>
            <div className="page-title">
              <h1>公演を編集</h1>
              <button
                onClick={() => {
                  if (confirm("保存していない変更を破棄しますか？")) {
                    setEdit(null);
                    baseline.current = null;
                  }
                }}
              >
                キャンセル
              </button>
            </div>
            {draftConflicted && (
              <div className="error">
                他の端末で更新されました。入力内容は保持しています。
                <button
                  onClick={() => {
                    if (
                      confirm("最新データを読み直し、この編集を破棄しますか？")
                    ) {
                      const s = state.data.shows.find(
                        (x) => x.id === edit.show.id,
                      );
                      if (s) startEdit(s);
                    }
                  }}
                >
                  最新を読み直す
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        "他の端末のこの公演への変更を、現在の編集中の内容で置き換えます。保存する内容を確認しましたか？",
                      )
                    ) {
                      baseline.current = copy(state);
                      setDraftConflicted(false);
                    }
                  }}
                >
                  自分の編集を選ぶ
                </button>
              </div>
            )}
            <section className="card fields">
              <label>
                公演名
                <input
                  value={edit.show.name}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, name: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                会場
                <input
                  value={edit.show.venue}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, venue: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                日付
                <input
                  type="date"
                  value={edit.show.date}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, date: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                公演回
                <input
                  value={edit.show.slot}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, slot: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                開演時刻（任意）
                <input
                  type="time"
                  value={edit.show.startsAt?.slice(11, 16) ?? ""}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: {
                        ...edit.show,
                        startsAt: e.target.value
                          ? edit.show.date + "T" + e.target.value + ":00+09:00"
                          : null,
                      },
                    })
                  }
                />
              </label>
              <label>
                基本セトリ
                <select
                  value={edit.show.templateId ?? ""}
                  onChange={(e) => {
                    if (!confirm("選択した基本セトリの曲順を読み込みますか？"))
                      return;
                    const template = data.templates.find(
                      (t) => t.id === e.target.value,
                    );
                    setEdit({
                      ...edit,
                      show: { ...edit.show, templateId: template?.id ?? null },
                      entries: copy(template?.entries ?? edit.entries),
                    });
                  }}
                >
                  <option value="">直接入力</option>
                  {data.templates
                    .filter((t) => t.tourId === edit.show.tourId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                座席
                <input
                  value={edit.seat}
                  onChange={(e) => setEdit({ ...edit, seat: e.target.value })}
                />
              </label>
              <label>
                感想
                <textarea
                  value={edit.note}
                  onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                />
              </label>
              <label>
                公演メモ
                <textarea
                  value={edit.show.note}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, note: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                未発表新曲の確認
                <select
                  value={edit.show.surpriseReview}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: {
                        ...edit.show,
                        surpriseReview: e.target
                          .value as Show["surpriseReview"],
                      },
                    })
                  }
                >
                  <option value="UNREVIEWED">未確認</option>
                  <option value="NONE">未発表新曲なし</option>
                  <option value="REVIEWED">確認した</option>
                </select>
              </label>
            </section>
            <section className="card">
              <h2>セットリスト</h2>
              <EntryEditor
                entries={edit.entries}
                songs={allSongs}
                onChange={(entries) => setEdit({ ...edit, entries })}
              />
              <details>
                <summary>公演固有の披露事実</summary>
                {edit.entries.map((entry) => {
                  const fact = edit.facts.find((f) => f.entryKey === entry.id);
                  const change = (
                    key: "unpublishedBeforeShow" | "firstPerformedAtShow",
                    value: boolean,
                  ) => {
                    const next = fact ?? {
                      id: crypto.randomUUID(),
                      revision: 0,
                      showId: edit.show.id,
                      entryKey: entry.id,
                      unpublishedBeforeShow: false,
                      firstPerformedAtShow: false,
                      note: "",
                    };
                    setEdit({
                      ...edit,
                      facts: [
                        ...edit.facts.filter((f) => f.entryKey !== entry.id),
                        { ...next, [key]: value },
                      ],
                    });
                  };
                  return (
                    <div className="fields edit-entry" key={entry.id}>
                      <strong>{title(entry.songRef)}</strong>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={fact?.unpublishedBeforeShow ?? false}
                          onChange={(e) =>
                            change("unpublishedBeforeShow", e.target.checked)
                          }
                        />
                        公演前まで未発表
                      </label>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={fact?.firstPerformedAtShow ?? false}
                          onChange={(e) =>
                            change("firstPerformedAtShow", e.target.checked)
                          }
                        />
                        この公演で初披露
                      </label>
                    </div>
                  );
                })}
              </details>
              <button
                className="primary"
                disabled={busy || !online || draftConflicted}
                onClick={saveEdit}
              >
                変更を保存
              </button>
            </section>
          </>
        ) : show ? (
          <>
            <button onClick={() => setShowId(null)}>
              <ArrowLeft size={16} />
              公演一覧に戻る
            </button>
            <section className="glass hero">
              <p className="eyebrow">
                {show.date.replaceAll("-", ".")} · {show.format}
              </p>
              <h1>{show.venue}</h1>
              <p>
                {data.tours.find((t) => t.id === show.tourId)?.name ??
                  show.name}
              </p>
              <div className="actions">
                <CheckIn s={show} />
                <button
                  disabled={busy || !online}
                  onClick={() => startEdit(show)}
                >
                  <Pencil size={16} />
                  編集
                </button>
              </div>
            </section>
            <section className="card">
              <h2>セットリスト</h2>
              {!show.hasSavedSetlist ? (
                <p className="empty">セトリ未入力</p>
              ) : (
                effectiveEntries(data, show)?.map((entry, i) => (
                  <div className="track" key={entry.id}>
                    <span className="order">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <strong>{title(entry.songRef)}</strong>
                      <div className="badges">
                        <span>
                          {entry.section === "ENCORE" ? "アンコール" : "本編"}
                        </span>
                        <span>{entry.version ?? "—"}</span>
                        {entry.medleyGroup && <span>メドレー</span>}
                        {data.entryFacts.some(
                          (f) =>
                            f.showId === show.id &&
                            f.entryKey === entry.id &&
                            f.unpublishedBeforeShow &&
                            f.firstPerformedAtShow,
                        ) && <span>未発表新曲 初披露</span>}
                      </div>
                    </div>
                    {data.songMetadata.find((m) => m.songRef === entry.songRef)
                      ?.appleMusicUrl && (
                      <a
                        href={
                          data.songMetadata.find(
                            (m) => m.songRef === entry.songRef,
                          )!.appleMusicUrl!
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        聴く
                      </a>
                    )}
                  </div>
                ))
              )}
            </section>
            <section className="card">
              <h2>参加記録</h2>
              <p>
                {data.attendance.find((a) => a.showId === show.id)?.seat ||
                  "座席 —"}
              </p>
              <p>
                {data.attendance.find((a) => a.showId === show.id)?.note ||
                  "感想 —"}
              </p>
            </section>
            <section className="card">
              <h2>他公演との差分</h2>
              {data.shows
                .filter(
                  (s) =>
                    s.id !== show.id &&
                    s.tourId === show.tourId &&
                    s.hasSavedSetlist,
                )
                .map((s) => {
                  const current = effectiveEntries(data, show),
                    other = effectiveEntries(data, s)!;
                  return (
                    <p key={s.id}>
                      {s.date} ·{" "}
                      {current
                        ? `${
                            other
                              .filter(
                                (e) =>
                                  !current.some((x) => x.songRef === e.songRef),
                              )
                              .map((e) => title(e.songRef))
                              .join("、") || "追加曲なし"
                          }`
                        : "セトリ未入力"}
                    </p>
                  );
                })}
              {!data.shows.some(
                (s) =>
                  s.id !== show.id &&
                  s.tourId === show.tourId &&
                  s.hasSavedSetlist,
              ) && <p className="empty">比較できるセトリがありません</p>}
            </section>
          </>
        ) : (
          <>
            {tab === "HOME" && (
              <>
                <div className="page-title">
                  <h1>HOME</h1>
                  <span className="eyebrow">MY ARCHIVE</span>
                </div>
                <div className="metrics">
                  <div className="glass metric">
                    <span>ライブ数</span>
                    <strong>
                      {mine.length}
                      <small>公演</small>
                    </strong>
                  </div>
                  <div className="glass metric">
                    <span>聴いた曲</span>
                    <strong>
                      {heard.size}
                      <small>曲</small>
                    </strong>
                  </div>
                </div>
                <section>
                  <h2>最近参加したライブ</h2>
                  {latest ? (
                    <div
                      className="glass latest"
                      onClick={() => openShow(latest)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openShow(latest);
                      }}
                    >
                      <span className="eyebrow">
                        {latest.date.replaceAll("-", ".")}
                      </span>
                      <h2>{latest.venue}</h2>
                      <p>
                        {data.tours.find((t) => t.id === latest.tourId)?.name ??
                          latest.name}
                      </p>
                      <span className="aqua">公演を見る →</span>
                    </div>
                  ) : (
                    <div className="card empty">
                      参加したライブはまだありません
                      <button onClick={() => navigate("LIVE")}>
                        ライブ一覧へ
                      </button>
                    </div>
                  )}
                </section>
                <section className="card shortcut">
                  <ChartNoAxesCombined size={22} />
                  <div>
                    <h2>楽曲ランキング</h2>
                    <p>{myStats[0] ? title(myStats[0].songRef) : "—"}</p>
                  </div>
                  <button onClick={() => navigate("ANALYSIS")}>見る →</button>
                </section>
              </>
            )}
            {tab === "LIVE" && (
              <>
                <div className="page-title">
                  <h1>LIVE</h1>
                  <span>{data.shows.length}公演</span>
                </div>
                <input
                  className="search"
                  aria-label="公演を検索"
                  placeholder="ツアー名・日付・会場で検索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {[...data.tours]
                  .sort((a, b) => b.startDate.localeCompare(a.startDate))
                  .map((t) => {
                    const list = searchShows.filter((s) => s.tourId === t.id);
                    return list.length ? (
                      <section className="card tour" key={t.id}>
                        <button
                          className="tour-title"
                          aria-expanded={expanded === t.id}
                          onClick={() => {
                            const next = expanded === t.id ? null : t.id;
                            setExpanded(next);
                            if (next) sessionStorage.setItem("lastTour", next);
                          }}
                        >
                          <span>
                            <span className="eyebrow">
                              {t.startDate.slice(0, 4)} · {list.length}公演
                            </span>
                            <strong>{t.name}</strong>
                          </span>
                          <span>{expanded === t.id ? "−" : "＋"}</span>
                        </button>
                        {expanded === t.id &&
                          list
                            .sort((a, b) => a.date.localeCompare(b.date))
                            .map((s) => <ShowCard key={s.id} s={s} />)}
                      </section>
                    ) : null;
                  })}
                {searchShows
                  .filter((s) => !s.tourId)
                  .map((s) => (
                    <section className="card" key={s.id}>
                      <ShowCard s={s} />
                    </section>
                  ))}
                {!searchShows.length && (
                  <p className="empty">公演がありません</p>
                )}
              </>
            )}
            {tab === "MY LIVE" && (
              <>
                <h1>ライブ履歴</h1>
                {[...mine]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((s) => (
                    <section className="card" key={s.id}>
                      <ShowCard s={s} />
                    </section>
                  ))}
                {!mine.length && (
                  <p className="empty">参加したライブはまだありません</p>
                )}
                <section className="card">
                  <h2>
                    聴いた曲 <span>{heard.size}</span>
                  </h2>
                  {myStats.map((s) => (
                    <p key={s.songRef}>{title(s.songRef)}</p>
                  ))}
                </section>
                <section className="card">
                  <h2>
                    まだ聴いていない曲 <span>{missing.length}</span>
                  </h2>
                  {missing.map((s) => (
                    <p key={s.ref}>{s.title}</p>
                  ))}
                </section>
              </>
            )}
            {tab === "ANALYSIS" && (
              <>
                <h1>楽曲ランキング</h1>
                <div className="segmented">
                  <button
                    className={scope === "mine" ? "selected" : ""}
                    onClick={() => setScope("mine")}
                  >
                    自分の参加公演
                  </button>
                  <button
                    className={scope === "all" ? "selected" : ""}
                    onClick={() => setScope("all")}
                  >
                    全公演
                  </button>
                </div>
                <section className="card filters">
                  <select
                    aria-label="年代"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  >
                    <option value="">すべての年</option>
                    {[
                      ...new Set(data.shows.map((s) => s.date.slice(0, 4))),
                    ].map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </select>
                  <select
                    aria-label="ツアー"
                    value={tourFilter}
                    onChange={(e) => setTourFilter(e.target.value)}
                  >
                    <option value="">すべてのツアー</option>
                    {data.tours.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="公演形式"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="">すべての形式</option>
                    {["ARENA", "DOME", "STADIUM", "FANMEETING", "OTHER"].map(
                      (f) => (
                        <option key={f}>{f}</option>
                      ),
                    )}
                  </select>
                  <select
                    aria-label="名義"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                  >
                    <option value="">すべての名義</option>
                    {[
                      ...new Set(allSongs.map((s) => s.artist).filter(Boolean)),
                    ].map((a) => (
                      <option key={a!}>{a}</option>
                    ))}
                  </select>
                  <select
                    aria-label="楽曲区分"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">全楽曲</option>
                    <option value="ORIGINAL">オリジナル</option>
                    <option value="COVER">カバー</option>
                    <option value="UNRELEASED">未音源化</option>
                  </select>
                </section>
                <section className="card ranking">
                  {stats.map((s, i) => (
                    <div className="rank-row" key={s.songRef}>
                      <span className="order">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{title(s.songRef)}</strong>
                        <small>
                          披露 {s.performances}回 · FULL {s.full} / SHORT{" "}
                          {s.short}
                        </small>
                      </div>
                      <strong className="aqua">
                        {s.shows}
                        <small>公演</small>
                      </strong>
                    </div>
                  ))}
                  {!stats.length && (
                    <p className="empty">集計できるセトリがありません</p>
                  )}
                </section>
                <section className="card">
                  <h2>レア曲分析</h2>
                  {[...stats]
                    .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))
                    .map((s) => (
                      <div className="rare" key={s.songRef}>
                        <span>{title(s.songRef)}</span>
                        <strong>
                          {s.rate === null
                            ? "—"
                            : (s.rate * 100).toFixed(1) + "%"}
                        </strong>
                      </div>
                    ))}
                  {!stats.length && <p className="empty">—</p>}
                </section>
              </>
            )}
            {tab === "SETTINGS" && (
              <>
                <h1>設定</h1>
                <LibraryEditor
                  data={data}
                  songs={allSongs}
                  disabled={busy || !online}
                  onDirty={(dirty) => {
                    if (dirty) libraryBase.current = copy(stateRef.current!);
                    else libraryBase.current = null;
                    setLibraryDirty(dirty);
                  }}
                  onSave={async (next, deleted) => {
                    const base = libraryBase.current!;
                    await atomicSave(next, base, deleted);
                  }}
                />
                <section className="card fields">
                  <h2>楽曲</h2>
                  <p>
                    {state.songs.filter((s) => s.available).length}曲 ·{" "}
                    {state.syncedAt
                      ? new Date(state.syncedAt).toLocaleString("ja-JP")
                      : "未同期"}
                  </p>
                  <button
                    disabled={busy || !online || preview}
                    onClick={() =>
                      void run(async () => {
                        await invoke("syncUniverse");
                        setSyncError("");
                        await refresh();
                      })
                    }
                  >
                    <RefreshCw size={16} />
                    Universeから同期
                  </button>
                  <button
                    disabled={busy || !online}
                    onClick={() =>
                      void run(async () => {
                        const name = prompt("LIVE限定曲の曲名");
                        if (!name?.trim()) return;
                        const artist = prompt("名義（任意）");
                        await save("localSongs", {
                          id: crypto.randomUUID(),
                          revision: 0,
                          title: name.trim(),
                          artist: artist?.trim() || null,
                        } as Dataset["localSongs"][number]);
                      })
                    }
                  >
                    LIVE限定曲を追加
                  </button>
                  {mergeCandidates(data.localSongs, state.songs).map((c) => (
                    <div key={c.localRef + c.universeRef}>
                      <p>{c.title} · 統合候補</p>
                      <button
                        disabled={preview || busy}
                        onClick={() =>
                          void run(async () => {
                            if (
                              !confirm(
                                "このLIVE限定曲のすべての参照をUniverse曲へ統合しますか？",
                              )
                            )
                              return;
                            await invoke("confirmSongMerge", {
                              ...c,
                              confirmed: true,
                              expected: {
                                datasetId: state.control.activeDatasetId,
                                revision: state.control.revision,
                              },
                            });
                            await refresh();
                          })
                        }
                      >
                        確認して統合
                      </button>
                    </div>
                  ))}
                </section>
                <section className="card fields">
                  <h2>バックアップ</h2>
                  <button
                    disabled={busy || !online}
                    onClick={() =>
                      download("live-archive.json", exportJson(data))
                    }
                  >
                    <Download size={16} />
                    JSONを書き出す
                  </button>
                  <label className="file-button">
                    <Upload size={16} />
                    JSONから復元
                    <input
                      type="file"
                      accept="application/json,.json"
                      disabled={busy || !online}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(async () => {
                            if (file.size > 8000000)
                              throw new Error("8MBを超えるバックアップです");
                            setBackup(parseBackup(await file.text()));
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {backup && (
                    <div className="restore">
                      <p>
                        公演 {backup.shows.length}件 / 基本セトリ{" "}
                        {backup.templates.length}件 / 参戦{" "}
                        {backup.attendance.filter((x) => x.attended).length}件
                      </p>
                      <p>現在のLIVEデータを全件置換します。</p>
                      <button
                        className="primary"
                        disabled={busy || !online}
                        onClick={() =>
                          void run(async () => {
                            if (
                              !confirm(
                                "内容を確認しました。現在のデータを全件置換しますか？",
                              )
                            )
                              return;
                            if (preview) {
                              setState({ ...state, data: backup });
                            } else {
                              await invoke("restoreBackup", {
                                data: backup,
                                expected: {
                                  datasetId: state.control.activeDatasetId,
                                  revision: state.control.revision,
                                },
                                confirmed: true,
                              });
                              await refresh();
                            }
                            setBackup(null);
                          })
                        }
                      >
                        確認して復元
                      </button>
                      <button onClick={() => setBackup(null)}>
                        キャンセル
                      </button>
                    </div>
                  )}
                  <button
                    disabled={
                      !state.control.previousDatasetId ||
                      busy ||
                      preview ||
                      !online
                    }
                    onClick={() =>
                      void run(async () => {
                        if (
                          !confirm(
                            "復元後に編集した内容は失われます。直前のデータへ戻しますか？",
                          )
                        )
                          return;
                        await invoke("rollbackRestore", {
                          expected: {
                            datasetId: state.control.activeDatasetId,
                            revision: state.control.revision,
                          },
                          confirmedLossOfEdits: true,
                        });
                        await refresh();
                      })
                    }
                  >
                    復元前に戻す
                  </button>
                </section>
                <button
                  disabled={busy || dirty}
                  onClick={() => void run(logout)}
                >
                  <LogOut size={16} />
                  ログアウト
                </button>
              </>
            )}
          </>
        )}
      </main>
      <nav aria-label="メインナビゲーション">
        {tabs.map(([name, Icon]) => (
          <button
            key={name}
            className={tab === name ? "active" : ""}
            onClick={() => navigate(name)}
          >
            <Icon size={21} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
