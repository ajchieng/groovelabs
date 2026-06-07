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
  Undo2,
} from "lucide-react";
import { GrooveVisualizer } from "./components/GrooveVisualizer";
import { defaultFramework, humanizerFrameworks } from "./data/humanizerFrameworks";
import { hatSubdivisionLabel, roleLabel, velocityToMidi } from "./engine/drumFormat";
import { applyHumanizerFramework } from "./engine/humanizerEngine";
import {
  RESET_VELOCITY,
  RESET_VELOCITY_MIDI,
  resetPatternToGrooveGrid,
} from "./engine/resetPattern";
import {
  AudiotoolProject,
  type AudiotoolRegion,
  type AudiotoolSession,
  createAudiotoolSession,
} from "./nexus/audiotoolClient";
import type {
  DrumEvent,
  HumanizerChange,
  HumanizerFrameworkId,
} from "./types/groove";

const clientId = import.meta.env.VITE_AUDIOTOOL_CLIENT_ID?.trim() ?? "";
const redirectUrl = "http://127.0.0.1:5173/";
const lastProjectUrlKey = "groovelab:last-project-url";
const audiotoolOauthStoragePrefix = `oidc_${clientId}_oidc_`;
const allRegionsId = "__all__";

export default function App() {
  const [session, setSession] = useState<AudiotoolSession | null>(null);
  const [project, setProject] = useState<AudiotoolProject | null>(null);
  const [projectUrl, setProjectUrl] = useState(() => readStoredProjectUrl());
  const [events, setEvents] = useState<DrumEvent[]>([]);
  const [regions, setRegions] = useState<AudiotoolRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState(allRegionsId);
  const [tempoBpm, setTempoBpm] = useState(90);
  const [selectedFrameworkId, setSelectedFrameworkId] =
    useState<HumanizerFrameworkId>(defaultFramework.id);
  const [strength, setStrength] = useState(1.4);
  const [humanizeSeed, setHumanizeSeed] = useState(1);
  const [status, setStatus] = useState("Checking Audiotool session");
  const [isBusy, setIsBusy] = useState(false);
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

  const hasAudiotoolClientId = clientId.length > 0;
  const isAuthenticated = session?.status === "authenticated";
  const selectedFramework = useMemo(
    () =>
      humanizerFrameworks.find((framework) => framework.id === selectedFrameworkId) ??
      defaultFramework,
    [selectedFrameworkId],
  );

  const humanizeResult = useMemo(
    () =>
      applyHumanizerFramework(events, selectedFramework, {
        strength,
        tempoBpm,
        seed: `${humanizeSeed}:${patternSeed(events)}`,
      }),
    [events, humanizeSeed, selectedFramework, strength, tempoBpm],
  );
  const roleCounts = humanizeResult.roleSummary;
  const previewStats = useMemo(() => summarizePreview(humanizeResult.changes), [humanizeResult]);

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      if (!hasAudiotoolClientId) {
        setStatus("Missing VITE_AUDIOTOOL_CLIENT_ID");
        setHasCheckedAuth(true);
        return;
      }

      cleanStaleAudiotoolLoginStateOnBoot();
      setIsBusy(true);
      try {
        const nextSession = await createAudiotoolSession({ clientId, redirectUrl });
        if (!isMounted) {
          return;
        }

        if (
          nextSession.status === "unauthenticated" &&
          isInvalidOauthStateError(nextSession.error)
        ) {
          clearAudiotoolOauthState();
          cleanAudiotoolCallbackUrl();
          setSession({
            ...nextSession,
            error: undefined,
          });
          setStatus("Cleaned stale Audiotool login state. Try logging in again.");
          return;
        }

        if (nextSession.status === "unauthenticated" && nextSession.error) {
          cleanAudiotoolCallbackUrl();
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
      void closeProject(project);
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

    cleanStaleAudiotoolLoginStateOnBoot();
    setIsBusy(true);
    try {
      const nextSession = await createAudiotoolSession({ clientId, redirectUrl });
      if (nextSession.status === "unauthenticated" && isInvalidOauthStateError(nextSession.error)) {
        clearAudiotoolOauthState();
        cleanAudiotoolCallbackUrl();
        setStatus("Cleaned stale Audiotool login state. Try logging in again.");
        return;
      }

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
      await closeProject(project);
      const nextProject = await session.openProject(trimmedProjectUrl);
      const snapshot = await nextProject.readDrumPattern();
      setProject(nextProject);
      setEvents(snapshot.events);
      setRegions(snapshot.regions);
      setSelectedRegionId(allRegionsId);
      setTempoBpm(snapshot.tempoBpm);
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
      const snapshot = await runProjectOperation((activeProject) =>
        activeProject.readDrumPattern(regionIdForRead(selectedRegionId)),
      );
      setEvents(snapshot.events);
      setRegions(snapshot.regions);
      if (selectedRegionId !== allRegionsId && !hasRegion(snapshot.regions, selectedRegionId)) {
        setSelectedRegionId(allRegionsId);
      }
      setTempoBpm(snapshot.tempoBpm);
      setHumanizeSeed((seed) => seed + 1);
      setStatus(
        `Reloaded ${snapshot.events.length} notes from ${regionStatusName(
          snapshot.regions,
          selectedRegionId,
        )}`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function selectRegion(regionId: string) {
    if (!project) {
      return;
    }

    setSelectedRegionId(regionId);
    setIsBusy(true);
    try {
      const snapshot = await runProjectOperation((activeProject) =>
        activeProject.readDrumPattern(regionIdForRead(regionId)),
      );
      setEvents(snapshot.events);
      setRegions(snapshot.regions);
      setTempoBpm(snapshot.tempoBpm);
      setHumanizeSeed((seed) => seed + 1);
      setStatus(
        `Focused ${snapshot.events.length} notes in ${regionStatusName(
          snapshot.regions,
          regionId,
        )}`,
      );
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
      const summary = await runProjectOperation((activeProject) =>
        activeProject.writeTransformedPattern(events, humanizeResult.events),
      );
      setStatus(
        `Wrote ${summary.updated} notes, created ${summary.created}, skipped ${summary.skipped}`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function resetPattern() {
    if (!project) {
      setStatus("Open a project before resetting");
      return;
    }

    if (events.length === 0) {
      setStatus("No notes loaded to reset");
      return;
    }

    const resetEvents = resetPatternToGrooveGrid(events, {
      hatSubdivision: humanizeResult.hatSubdivision,
    });
    setIsBusy(true);
    try {
      const summary = await runProjectOperation((activeProject) =>
        activeProject.writeTransformedPattern(events, resetEvents, {
          forcePatternSixteenthGrid: true,
          patternVelocity: RESET_VELOCITY,
        }),
      );
      if (summary.updated > 0 || summary.created > 0) {
        setEvents(resetEvents);
        setHumanizeSeed((seed) => seed + 1);
      }
      setStatus(
        `Reset ${summary.updated} notes. Hats to ${hatSubdivisionLabel(humanizeResult.hatSubdivision)}, kicks/snares to 8ths, velocity ${RESET_VELOCITY_MIDI}, skipped ${summary.skipped}`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function chooseDifferentProject() {
    void closeProject(project);
    setProject(null);
    setEvents([]);
    setRegions([]);
    setSelectedRegionId(allRegionsId);
    setStatus("Choose an Audiotool project");
  }

  function logout() {
    if (session?.status === "authenticated") {
      session.logout();
    }
    void closeProject(project);
    setSession(null);
    setProject(null);
    setEvents([]);
    setRegions([]);
    setSelectedRegionId(allRegionsId);
    setStatus("Logged out");
  }

  function resetLogin() {
    clearAudiotoolOauthState();
    window.history.replaceState({}, document.title, redirectUrl);
    setSession(null);
    setProject(null);
    setEvents([]);
    setRegions([]);
    setSelectedRegionId(allRegionsId);
    setHasCheckedAuth(false);
    setStatus("Reset Audiotool login state");
    window.location.assign(redirectUrl);
  }

  async function runProjectOperation<T>(
    operation: (activeProject: AudiotoolProject) => Promise<T>,
  ) {
    const activeProject = project ?? (await reopenProjectDocument());

    try {
      return await operation(activeProject);
    } catch (error) {
      if (!isDocumentStoppedError(error)) {
        throw error;
      }

      const reopenedProject = await reopenProjectDocument();
      return operation(reopenedProject);
    }
  }

  async function reopenProjectDocument() {
    if (session?.status !== "authenticated") {
      throw new Error("Log in with Audiotool first");
    }

    const trimmedProjectUrl = projectUrl.trim();
    if (!trimmedProjectUrl) {
      throw new Error("Paste an Audiotool project URL");
    }

    await closeProject(project);
    const nextProject = await session.openProject(trimmedProjectUrl);
    setProject(nextProject);
    setStatus("Reconnected to Audiotool project");
    return nextProject;
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
            <p>Drum humanizer for Audiotool notes</p>
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
              GrooveLab needs Audiotool access before loading projects or changing drum notes.
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
              {regions.length > 0 && (
                <>
                  <label className="field-label" htmlFor="region-select">
                    Drum region
                  </label>
                  <select
                    id="region-select"
                    className="select-input"
                    value={selectedRegionId}
                    onChange={(event) => {
                      void selectRegion(event.target.value);
                    }}
                    disabled={isBusy}
                  >
                    <option value={allRegionsId}>All regions ({totalRegionNotes(regions)})</option>
                    {regions.map((region) => (
                      <option key={region.id} value={region.id}>
                        {regionOptionLabel(region)}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </section>

            <section className="panel-block">
              <div className="section-title">
                <SlidersHorizontal size={18} />
                <h2>Humanizer</h2>
              </div>

              <div className="framework-list" role="listbox" aria-label="Humanizer framework">
                {humanizerFrameworks.map((framework) => (
                  <button
                    className="framework-button"
                    type="button"
                    key={framework.id}
                    data-active={framework.id === selectedFramework.id}
                    onClick={() => setSelectedFrameworkId(framework.id)}
                  >
                    <span>{framework.name}</span>
                    <small>{framework.description}</small>
                  </button>
                ))}
              </div>

              <label className="range-label" htmlFor="humanizer-strength">
                <span>Strength</span>
                <strong>{Math.round(strength * 100)}%</strong>
              </label>
              <input
                id="humanizer-strength"
                className="range-input"
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={strength}
                onChange={(event) => setStrength(Number(event.target.value))}
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
                  className="secondary-button"
                  type="button"
                  onClick={resetPattern}
                  disabled={isBusy || events.length === 0}
                  title="Quantize to 16ths and reset velocity"
                >
                  <Undo2 size={17} />
                  Reset
                </button>
              </div>
            </section>
          </aside>

          <section className="stage">
            <div className="stage-header">
              <div>
                <h2>{selectedFramework.name}</h2>
                <p>{humanizeResult.explanation}</p>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={writeBack}
                disabled={isBusy || events.length === 0}
              >
                <Save size={17} />
                Write Groove
              </button>
            </div>

            <div className="summary-grid">
              <div className="summary-tile">
                <span>Notes</span>
                <strong>{events.length}</strong>
              </div>
              <div className="summary-tile">
                <span>Strength</span>
                <strong>{Math.round(strength * 100)}%</strong>
              </div>
              <div className="summary-tile">
                <span>Hat Grid</span>
                <strong>{hatSubdivisionLabel(humanizeResult.hatSubdivision)}</strong>
              </div>
              <div className="summary-tile">
                <span>Max Move</span>
                <strong>{previewStats.maxShiftMs} ms</strong>
              </div>
              <div className="summary-tile">
                <span>Velocity</span>
                <strong>{previewStats.maxVelocityDeltaMidi}</strong>
              </div>
              <div className="summary-tile">
                <span>{roleLabel("kick")}</span>
                <strong>{roleCounts.kick}</strong>
              </div>
              <div className="summary-tile">
                <span>Snares</span>
                <strong>{roleCounts.snare + roleCounts.clap}</strong>
              </div>
              <div className="summary-tile">
                <span>Hats</span>
                <strong>{roleCounts.closed_hat + roleCounts.open_hat}</strong>
              </div>
            </div>

            <GrooveVisualizer
              originalEvents={events}
              transformedEvents={humanizeResult.events}
              changes={humanizeResult.changes}
            />

            <div className="analysis-panel">
              <div className="analysis-copy">
                <h3>Preview</h3>
                <p>{humanizeResult.explanation}</p>
              </div>
              <div className="change-list">
                {humanizeResult.changes
                  .filter((change) => change.shiftTicks !== 0 || change.velocityDelta !== 0)
                  .slice(0, 12)
                  .map((change) => (
                    <div className="change-row" key={change.id}>
                      <span>{roleLabel(change.role)}</span>
                      <strong>{formatSigned(change.shiftMs)} ms</strong>
                      <small>{formatSigned(velocityDeltaMidi(change))}</small>
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

function patternSeed(events: DrumEvent[]) {
  return events
    .map((event) => `${event.id}:${event.time}:${velocityToMidi(event.velocity)}`)
    .join("|");
}

function regionIdForRead(regionId: string) {
  return regionId === allRegionsId ? undefined : regionId;
}

function hasRegion(regions: AudiotoolRegion[], regionId: string) {
  return regions.some((region) => region.id === regionId);
}

function regionStatusName(regions: AudiotoolRegion[], regionId: string) {
  if (regionId === allRegionsId) {
    return "all regions";
  }
  return regions.find((region) => region.id === regionId)?.name ?? "selected region";
}

function totalRegionNotes(regions: AudiotoolRegion[]) {
  return regions.reduce((sum, region) => sum + region.noteCount, 0);
}

function regionOptionLabel(region: AudiotoolRegion) {
  const typeLabel = region.sourceType === "pattern" ? "Pattern" : "Notes";
  const context =
    region.trackName && region.trackName !== region.name
      ? ` - ${region.trackName}`
      : region.deviceName && region.deviceName !== region.name
        ? ` - ${region.deviceName}`
        : "";
  return `${region.name}${context} - ${typeLabel} (${region.noteCount})`;
}

function summarizePreview(changes: HumanizerChange[]) {
  return {
    maxShiftMs: Math.round(Math.max(0, ...changes.map((change) => Math.abs(change.shiftMs)))),
    maxVelocityDeltaMidi: Math.max(
      0,
      ...changes.map((change) => Math.abs(velocityDeltaMidi(change))),
    ),
  };
}

function velocityDeltaMidi(change: HumanizerChange) {
  return velocityToMidi(change.newVelocity) - velocityToMidi(change.originalVelocity);
}

function formatSigned(value: number) {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded >= 0 ? "+" : ""}${rounded}`;
}

function readStoredProjectUrl() {
  return window.localStorage.getItem(lastProjectUrlKey) ?? "";
}

function storeProjectUrl(projectUrl: string) {
  window.localStorage.setItem(lastProjectUrlKey, projectUrl);
}

function clearAudiotoolOauthState() {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(audiotoolOauthStoragePrefix) || isAudiotoolOauthStorageKey(key)) {
      window.localStorage.removeItem(key);
    }
  }
}

function cleanStaleAudiotoolLoginStateOnBoot() {
  const params = new URLSearchParams(window.location.search);
  const hasActiveCallback =
    params.has("code") ||
    params.has("state") ||
    params.has("error") ||
    params.has("error_description");

  if (hasActiveCallback) {
    return;
  }

  for (const key of Object.keys(window.localStorage)) {
    if (isAudiotoolPendingOauthKey(key)) {
      window.localStorage.removeItem(key);
    }
  }

  if (params.has("scope")) {
    cleanAudiotoolCallbackUrl();
  }
}

function cleanAudiotoolCallbackUrl() {
  const url = new URL(window.location.href);
  let changed = false;

  for (const param of ["code", "scope", "state", "error", "error_description"]) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }

  if (changed) {
    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, document.title, nextPath || "/");
  }
}

function isAudiotoolOauthStorageKey(key: string) {
  return key.startsWith("oidc_") && key.includes("_oidc_");
}

function isAudiotoolPendingOauthKey(key: string) {
  return (
    key === `${audiotoolOauthStoragePrefix}state` ||
    key === `${audiotoolOauthStoragePrefix}code_verifier` ||
    (key.startsWith("oidc_") && (key.endsWith("_oidc_state") || key.endsWith("_oidc_code_verifier")))
  );
}

function isInvalidOauthStateError(error?: string) {
  return error?.includes("Invalid state URL parameter") ?? false;
}

function isDocumentStoppedError(error: unknown) {
  return errorMessage(error).includes("Document stopped");
}

async function closeProject(project: AudiotoolProject | null) {
  try {
    await project?.close();
  } catch (error) {
    if (!isDocumentStoppedError(error)) {
      throw error;
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected Audiotool error";
}
