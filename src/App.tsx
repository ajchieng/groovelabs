import { useEffect, useMemo, useState } from "react";
import {
  Cable,
  Drum,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { VelocityVisualizer } from "./components/VelocityVisualizer";
import {
  humanizeVelocities,
  roleLabel,
  velocityToMidi,
} from "./engine/velocityHumanizer";
import {
  AudiotoolProject,
  type AudiotoolSession,
  createAudiotoolSession,
} from "./nexus/audiotoolClient";
import type { DrumEvent, DrumRole } from "./types/groove";

const clientId = import.meta.env.VITE_AUDIOTOOL_CLIENT_ID?.trim() ?? "";
const redirectUrl = "http://127.0.0.1:5173/";
const lastProjectUrlKey = "groovelab:last-project-url";
const audiotoolOauthStoragePrefix = `oidc_${clientId}_oidc_`;

const ROLE_ORDER: DrumRole[] = [
  "kick",
  "snare",
  "clap",
  "closed_hat",
  "open_hat",
  "perc",
  "unknown",
];

export default function App() {
  const [session, setSession] = useState<AudiotoolSession | null>(null);
  const [project, setProject] = useState<AudiotoolProject | null>(null);
  const [projectUrl, setProjectUrl] = useState(() => readStoredProjectUrl());
  const [events, setEvents] = useState<DrumEvent[]>([]);
  const [velocityRangeMidi, setVelocityRangeMidi] = useState(10);
  const [humanizeSeed, setHumanizeSeed] = useState(1);
  const [status, setStatus] = useState("Checking Audiotool session");
  const [isBusy, setIsBusy] = useState(false);
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

  const hasAudiotoolClientId = clientId.length > 0;
  const isAuthenticated = session?.status === "authenticated";

  const humanizeResult = useMemo(
    () =>
      humanizeVelocities(events, {
        rangeMidi: velocityRangeMidi,
        seed: `${humanizeSeed}:${patternSeed(events)}`,
      }),
    [events, humanizeSeed, velocityRangeMidi],
  );
  const roleCounts = useMemo(() => countRoles(events), [events]);

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      if (!hasAudiotoolClientId) {
        setStatus("Missing VITE_AUDIOTOOL_CLIENT_ID");
        setHasCheckedAuth(true);
        return;
      }

      setIsBusy(true);
      try {
        const nextSession = await createAudiotoolSession({ clientId, redirectUrl });
        if (!isMounted) {
          return;
        }

        setSession(nextSession);
        setStatus(
          nextSession.status === "authenticated"
            ? `Connected as ${nextSession.userName}`
            : nextSession.error
              ? `Audiotool auth failed: ${nextSession.error}`
              : "Audiotool login required",
        );
      } catch (error) {
        if (isMounted) {
          setStatus(errorMessage(error));
        }
      } finally {
        if (isMounted) {
          setHasCheckedAuth(true);
          setIsBusy(false);
        }
      }
    }

    void checkSession();

    return () => {
      isMounted = false;
    };
  }, [hasAudiotoolClientId]);

  useEffect(() => {
    return () => {
      void project?.close();
    };
  }, [project]);

  async function login() {
    if (!hasAudiotoolClientId) {
      setStatus("Missing VITE_AUDIOTOOL_CLIENT_ID");
      return;
    }

    if (session?.status === "unauthenticated") {
      session.login();
      return;
    }

    setIsBusy(true);
    try {
      const nextSession = await createAudiotoolSession({ clientId, redirectUrl });
      setSession(nextSession);
      if (nextSession.status === "unauthenticated") {
        nextSession.login();
      } else {
        setStatus(`Connected as ${nextSession.userName}`);
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function openProject() {
    if (session?.status !== "authenticated") {
      setStatus("Log in with Audiotool first");
      return;
    }

    const trimmedProjectUrl = projectUrl.trim();
    if (!trimmedProjectUrl) {
      setStatus("Paste an Audiotool project URL");
      return;
    }

    setIsBusy(true);
    try {
      await project?.close();
      const nextProject = await session.openProject(trimmedProjectUrl);
      const snapshot = await nextProject.readDrumPattern();
      setProject(nextProject);
      setEvents(snapshot.events);
      setHumanizeSeed((seed) => seed + 1);
      storeProjectUrl(trimmedProjectUrl);
      setStatus(
        snapshot.events.length > 0
          ? `Loaded ${snapshot.events.length} Audiotool notes`
          : "Project opened, no timeline note entities found",
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function reloadProject() {
    if (!project) {
      setStatus("Open a project first");
      return;
    }

    setIsBusy(true);
    try {
      const snapshot = await project.readDrumPattern();
      setEvents(snapshot.events);
      setHumanizeSeed((seed) => seed + 1);
      setStatus(`Reloaded ${snapshot.events.length} notes`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function writeBack() {
    if (!project) {
      setStatus("Open a project before writing");
      return;
    }

    setIsBusy(true);
    try {
      const summary = await project.writeVelocities(events, humanizeResult.events);
      setStatus(`Updated velocity on ${summary.updated} notes, skipped ${summary.skipped}`);
      const snapshot = await project.readDrumPattern();
      setEvents(snapshot.events);
      setHumanizeSeed((seed) => seed + 1);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function chooseDifferentProject() {
    void project?.close();
    setProject(null);
    setEvents([]);
    setStatus("Choose an Audiotool project");
  }

  function logout() {
    if (session?.status === "authenticated") {
      session.logout();
    }
    void project?.close();
    setSession(null);
    setProject(null);
    setEvents([]);
    setStatus("Logged out");
  }

  function resetLogin() {
    clearAudiotoolOauthState();
    window.history.replaceState({}, document.title, redirectUrl);
    setSession(null);
    setProject(null);
    setEvents([]);
    setHasCheckedAuth(false);
    setStatus("Reset Audiotool login state");
    window.location.assign(redirectUrl);
  }

  const shouldShowLoginGate =
    !hasCheckedAuth || !hasAudiotoolClientId || session?.status !== "authenticated";
  const shouldShowProjectGate = isAuthenticated && !project;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Drum size={22} strokeWidth={2.4} />
          </span>
          <div>
            <h1>GrooveLab</h1>
            <p>Velocity humanizer for Audiotool notes</p>
          </div>
        </div>
        <div className="status-pill" data-busy={isBusy}>
          {isBusy ? "Working" : status}
        </div>
      </header>

      {shouldShowLoginGate ? (
        <main className="gate-shell">
          <section className="gate-panel">
            <div className="gate-icon">
              <LogIn size={24} />
            </div>
            <h2>Log in with Audiotool</h2>
            <p>
              GrooveLab needs Audiotool access before loading projects or changing note
              velocities.
            </p>
            {session?.status === "unauthenticated" && session.error && (
              <div className="notice">
                Audiotool returned: {session.error}
              </div>
            )}
            {!hasAudiotoolClientId && (
              <div className="notice">Add VITE_AUDIOTOOL_CLIENT_ID in .env.local</div>
            )}
            <div className="button-row gate-actions">
              <button
                className="primary-button"
                type="button"
                onClick={login}
                disabled={isBusy || !hasCheckedAuth || !hasAudiotoolClientId}
              >
                <LogIn size={17} />
                Continue with Audiotool
              </button>
              <button className="secondary-button" type="button" onClick={resetLogin}>
                Reset Login
              </button>
            </div>
          </section>
        </main>
      ) : shouldShowProjectGate ? (
        <main className="gate-shell">
          <section className="gate-panel project-gate-panel">
            <div className="gate-icon">
              <Cable size={24} />
            </div>
            <h2>Open an Audiotool project</h2>
            <p>Paste a beta studio project URL before opening the humanizer workspace.</p>
            <label className="field-label" htmlFor="project-url">
              Project URL
            </label>
            <input
              id="project-url"
              className="text-input"
              value={projectUrl}
              onChange={(event) => setProjectUrl(event.target.value)}
              placeholder="https://beta.audiotool.com/studio?project=..."
            />
            <div className="button-row gate-actions">
              <button
                className="primary-button"
                type="button"
                onClick={openProject}
                disabled={isBusy || !projectUrl.trim()}
              >
                <Cable size={17} />
                Open Project
              </button>
              <button className="icon-button" type="button" onClick={logout} title="Log out">
                <LogOut size={17} />
              </button>
            </div>
          </section>
        </main>
      ) : (
        <main className="workspace">
          <aside className="control-panel">
            <section className="panel-block">
              <div className="section-title">
                <Cable size={18} />
                <h2>Project</h2>
              </div>
              <div className="project-url-display" title={projectUrl}>
                {projectUrl}
              </div>
              <div className="button-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={reloadProject}
                  disabled={isBusy}
                >
                  <RefreshCw size={17} />
                  Reload
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={chooseDifferentProject}
                  disabled={isBusy}
                >
                  <Cable size={17} />
                  Change
                </button>
                <button className="icon-button" type="button" onClick={logout} title="Log out">
                  <LogOut size={17} />
                </button>
              </div>
            </section>

            <section className="panel-block">
              <div className="section-title">
                <SlidersHorizontal size={18} />
                <h2>Humanizer</h2>
              </div>

              <label className="range-label" htmlFor="velocity-range">
                <span>Velocity range</span>
                <strong>+/-{velocityRangeMidi}</strong>
              </label>
              <input
                id="velocity-range"
                className="range-input"
                type="range"
                min="0"
                max="32"
                step="1"
                value={velocityRangeMidi}
                onChange={(event) => setVelocityRangeMidi(Number(event.target.value))}
              />

              <div className="button-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setHumanizeSeed((seed) => seed + 1)}
                >
                  <RotateCcw size={17} />
                  Reroll
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={writeBack}
                  disabled={isBusy || events.length === 0}
                >
                  <Save size={17} />
                  Write
                </button>
              </div>
            </section>
          </aside>

          <section className="stage">
            <div className="stage-header">
              <div>
                <h2>Velocity Humanizer</h2>
                <p>
                  Randomizes each note velocity within +/-{velocityRangeMidi} MIDI units. Timing,
                  pitch, and duration stay unchanged.
                </p>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={writeBack}
                disabled={isBusy || events.length === 0}
              >
                <Save size={17} />
                Write Velocities
              </button>
            </div>

            <div className="summary-grid">
              <div className="summary-tile">
                <span>Notes</span>
                <strong>{events.length}</strong>
              </div>
              <div className="summary-tile">
                <span>Range</span>
                <strong>+/-{velocityRangeMidi}</strong>
              </div>
              <div className="summary-tile">
                <span>Avg Delta</span>
                <strong>{Math.round(humanizeResult.averageAbsoluteDeltaMidi)}</strong>
              </div>
              <div className="summary-tile">
                <span>Max Delta</span>
                <strong>{humanizeResult.maxAbsoluteDeltaMidi}</strong>
              </div>
              {ROLE_ORDER.slice(0, 3).map((role) => (
                <div className="summary-tile" key={role}>
                  <span>{roleLabel(role)}</span>
                  <strong>{roleCounts[role]}</strong>
                </div>
              ))}
            </div>

            <VelocityVisualizer changes={humanizeResult.changes} />

            <div className="analysis-panel">
              <div className="analysis-copy">
                <h3>Preview</h3>
                <p>{humanizeResult.explanation}</p>
              </div>
              <div className="change-list">
                {humanizeResult.changes.slice(0, 10).map((change) => (
                  <div className="change-row" key={change.id}>
                    <span>{roleLabel(change.role)}</span>
                    <strong>
                      {change.originalVelocityMidi}
                      {" -> "}
                      {change.newVelocityMidi}
                    </strong>
                    <small>
                      {change.deltaMidi >= 0 ? "+" : ""}
                      {change.deltaMidi}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

function countRoles(events: DrumEvent[]) {
  return events.reduce(
    (counts, event) => {
      counts[event.role] += 1;
      return counts;
    },
    {
      kick: 0,
      snare: 0,
      clap: 0,
      closed_hat: 0,
      open_hat: 0,
      perc: 0,
      unknown: 0,
    } satisfies Record<DrumRole, number>,
  );
}

function patternSeed(events: DrumEvent[]) {
  return events
    .map((event) => `${event.id}:${event.time}:${velocityToMidi(event.velocity)}`)
    .join("|");
}

function readStoredProjectUrl() {
  return window.localStorage.getItem(lastProjectUrlKey) ?? "";
}

function storeProjectUrl(projectUrl: string) {
  window.localStorage.setItem(lastProjectUrlKey, projectUrl);
}

function clearAudiotoolOauthState() {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(audiotoolOauthStoragePrefix)) {
      window.localStorage.removeItem(key);
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected Audiotool error";
}
