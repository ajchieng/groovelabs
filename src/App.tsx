import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Cable,
  Check,
  Download,
  Drum,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Undo2,
  X,
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
  DRUM_ROLE_ORDER,
  applyRoleSelection,
  createAllRolesSelection,
  createNoRolesSelection,
  selectedRolesFromSelection,
  type RoleSelection,
} from "./engine/roleSelection";
import {
  AudiotoolProject,
  type AudiotoolRegion,
  type AudiotoolSession,
  type AudiotoolWriteSummary,
  createAudiotoolSession,
} from "./nexus/audiotoolClient";
import type {
  DrumEvent,
  DrumRole,
  HumanizerChange,
  HumanizerFrameworkId,
} from "./types/groove";
import {
  reduceLastWriteSnapshot,
  summarizeWriteReview,
  undoTargetEvents,
  type LastWriteSnapshot,
  type WriteSnapshotAction,
} from "./engine/writeSafety";

const clientId = import.meta.env.VITE_AUDIOTOOL_CLIENT_ID?.trim() ?? "";
const redirectUrl = "http://127.0.0.1:5173/";
const lastProjectUrlKey = "groovelab:last-project-url";
const audiotoolOauthStoragePrefix = `oidc_${clientId}_oidc_`;
const allRegionsId = "__all__";
type PendingWriteAction = Extract<WriteSnapshotAction, "groove" | "reset">;

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
  const [pendingWriteAction, setPendingWriteAction] = useState<PendingWriteAction | null>(null);
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<RoleSelection>(() =>
    createAllRolesSelection(),
  );
  const [lastWriteSnapshot, setLastWriteSnapshot] =
    useState<LastWriteSnapshot<AudiotoolWriteSummary> | null>(null);

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
  const loadedRoleOptions = useMemo(
    () => DRUM_ROLE_ORDER.filter((role) => roleCounts[role] > 0),
    [roleCounts],
  );
  const resetAllEvents = useMemo(
    () =>
      resetPatternToGrooveGrid(events, {
        hatSubdivision: humanizeResult.hatSubdivision,
      }),
    [events, humanizeResult.hatSubdivision],
  );
  const selectiveHumanizeResult = useMemo(
    () =>
      applyRoleSelection({
        beforeEvents: events,
        afterEvents: humanizeResult.events,
        changes: humanizeResult.changes,
        selectedRoles,
      }),
    [events, humanizeResult.changes, humanizeResult.events, selectedRoles],
  );
  const activeReviewEvents =
    pendingWriteAction === "reset" ? resetAllEvents : selectiveHumanizeResult.events;
  const activeReviewChanges =
    pendingWriteAction === "reset" ? [] : selectiveHumanizeResult.changes;
  const activeReviewSelectedCount =
    pendingWriteAction === "reset" ? events.length : selectiveHumanizeResult.selectedCount;
  const selectedRoleNames = useMemo(
    () => selectedRolesFromSelection(selectedRoles),
    [selectedRoles],
  );
  const previewStats = useMemo(
    () => summarizePreview(selectiveHumanizeResult.changes),
    [selectiveHumanizeResult.changes],
  );
  const writeReview = useMemo(
    () =>
      summarizeWriteReview(
        events,
        activeReviewEvents,
        activeReviewChanges,
      ),
    [activeReviewChanges, activeReviewEvents, events],
  );

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      if (!hasAudiotoolClientId) {
        setStatus("Missing VITE_AUDIOTOOL_CLIENT_ID");
        setHasCheckedAuth(true);
        return;
      }

      // The OAuth state/code_verifier live in localStorage, which is partitioned per
      // origin. Audiotool always returns to the registered redirectUrl origin, so if we
      // start the flow on a different origin (e.g. localhost vs 127.0.0.1) the saved
      // state is invisible on the callback and login appears to fail the first time.
      // Bounce to the canonical origin up front so login starts and ends in one place.
      if (redirectToCanonicalOrigin()) {
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
      clearPendingWriteState();
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
      clearPendingWriteState();
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
      clearPendingWriteState();
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

  function reviewWriteBack() {
    if (!project) {
      setStatus("Open a project before writing");
      return;
    }

    if (events.length === 0) {
      setStatus("No notes loaded to write");
      return;
    }

    if (!hasSelectedRoles(selectedRoleNames)) {
      setStatus("Select at least one drum part before writing");
      return;
    }

    if (selectiveHumanizeResult.selectedCount === 0) {
      setStatus("Selected drum parts have no loaded notes");
      return;
    }

    setPendingWriteAction("groove");
    setStatus("Review groove changes before writing");
  }

  async function writeBack() {
    if (!project) {
      setStatus("Open a project before writing");
      return;
    }

    setIsBusy(true);
    try {
      const beforeEvents = events;
      const afterEvents = selectiveHumanizeResult.events;
      const summary = await runProjectOperation((activeProject) =>
        activeProject.writeTransformedPattern(beforeEvents, afterEvents),
      );
      if (summary.updated > 0 || summary.created > 0) {
        setEvents(afterEvents);
        setLastWriteSnapshot((current) =>
          reduceLastWriteSnapshot(current, {
            type: "write-succeeded",
            snapshot: {
              action: "groove",
              regionId: selectedRegionId,
              selectedRoles: selectedRoleNames,
              beforeEvents,
              afterEvents,
              summary,
              createdAt: Date.now(),
            },
          }),
        );
        setHumanizeSeed((seed) => seed + 1);
      } else {
        setLastWriteSnapshot(null);
      }
      setPendingWriteAction(null);
      setStatus(
        `Wrote ${summary.updated} notes, created ${summary.created}, skipped ${summary.skipped}. Loaded state now reflects the write.`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function reviewResetPattern() {
    if (!project) {
      setStatus("Open a project before resetting");
      return;
    }

    if (events.length === 0) {
      setStatus("No notes loaded to reset");
      return;
    }

    setPendingWriteAction("reset");
    setStatus("Review reset before writing");
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

    const beforeEvents = events;
    const resetEvents = resetAllEvents;
    setIsBusy(true);
    try {
      // Reset uses a forced 16th-capable pattern grid so Audiotool drum-machine
      // steps can receive the same hard-quantized positions as note regions.
      const summary = await runProjectOperation((activeProject) =>
        activeProject.writeTransformedPattern(beforeEvents, resetEvents, {
          forcePatternSixteenthGrid: true,
          patternVelocity: RESET_VELOCITY,
        }),
      );
      if (summary.updated > 0 || summary.created > 0) {
        setEvents(resetEvents);
        setLastWriteSnapshot((current) =>
          reduceLastWriteSnapshot(current, {
            type: "write-succeeded",
            snapshot: {
              action: "reset",
              regionId: selectedRegionId,
              selectedRoles: [...DRUM_ROLE_ORDER],
              beforeEvents,
              afterEvents: resetEvents,
              summary,
              createdAt: Date.now(),
            },
          }),
        );
        setHumanizeSeed((seed) => seed + 1);
      } else {
        setLastWriteSnapshot(null);
      }
      setPendingWriteAction(null);
      setStatus(
        `Reset ${summary.updated} notes. Hats to ${hatSubdivisionLabel(humanizeResult.hatSubdivision)}, kicks/snares to 16ths, velocity ${RESET_VELOCITY_MIDI}, skipped ${summary.skipped}`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmPendingWrite() {
    if (pendingWriteAction === "reset") {
      await resetPattern();
      return;
    }

    if (pendingWriteAction === "groove") {
      await writeBack();
    }
  }

  function cancelPendingWrite() {
    setPendingWriteAction(null);
    setStatus("Write canceled");
  }

  async function undoLastWrite() {
    if (!lastWriteSnapshot) {
      setStatus("No write to undo");
      return;
    }

    if (!project) {
      setStatus("Open a project before undoing");
      return;
    }

    setIsBusy(true);
    try {
      const summary = await runProjectOperation((activeProject) =>
        activeProject.writeTransformedPattern(
          lastWriteSnapshot.afterEvents,
          undoTargetEvents(lastWriteSnapshot),
        ),
      );
      setEvents(lastWriteSnapshot.beforeEvents);
      setHumanizeSeed((seed) => seed + 1);
      clearPendingWriteState();
      setStatus(
        `Undid ${writeActionLabel(lastWriteSnapshot.action).toLowerCase()}: wrote ${summary.updated} notes, created ${summary.created}, skipped ${summary.skipped}`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function exportSnapshot() {
    if (events.length === 0) {
      setStatus("No loaded notes to export");
      return;
    }

    const snapshot = {
      exportedAt: new Date().toISOString(),
      projectUrl,
      selectedRegionId,
      selectedRegion: regionStatusName(regions, selectedRegionId),
      tempoBpm,
      selectedRoles: selectedRoleNames,
      roleSelection: selectedRoles,
      writeReview,
      events,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const snapshotUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = snapshotUrl;
    anchor.download = `groovelab-${safeFilename(
      regionStatusName(regions, selectedRegionId),
    )}-${timestampForFilename()}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(snapshotUrl), 0);
    setStatus(
      `Exported ${events.length} notes from ${regionStatusName(regions, selectedRegionId)}`,
    );
  }

  function clearPendingWriteState() {
    setPendingWriteAction(null);
    setLastWriteSnapshot((current) =>
      reduceLastWriteSnapshot(current, { type: "workspace-changed" }),
    );
  }

  function toggleSelectedRole(role: DrumRole) {
    setSelectedRoles((current) => ({
      ...current,
      [role]: !current[role],
    }));
  }

  function selectAllRoles() {
    setSelectedRoles(createAllRolesSelection());
    setStatus("Selected all drum parts");
  }

  function selectNoRoles() {
    setSelectedRoles(createNoRolesSelection());
    setStatus("Deselected all drum parts");
  }

  function chooseDifferentProject() {
    void closeProject(project);
    setProject(null);
    setEvents([]);
    setRegions([]);
    setSelectedRegionId(allRegionsId);
    clearPendingWriteState();
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
    clearPendingWriteState();
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
    clearPendingWriteState();
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
            <section className="panel-block workflow-step">
              <div className="section-title">
                <Cable size={18} />
                <span className="step-index">1</span>
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
                <button
                  className="secondary-button"
                  type="button"
                  onClick={exportSnapshot}
                  disabled={isBusy || events.length === 0}
                >
                  <Download size={17} />
                  Export
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    void undoLastWrite();
                  }}
                  disabled={isBusy || !lastWriteSnapshot}
                  title={lastWriteSnapshot ? undoTitle(lastWriteSnapshot) : "No write to undo"}
                >
                  <Undo2 size={17} />
                  Undo Write
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

            <section className="panel-block workflow-step">
              <div className="section-title">
                <SlidersHorizontal size={18} />
                <span className="step-index">2</span>
                <h2>Groove</h2>
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

              {loadedRoleOptions.length > 0 && (
                <div className="role-selector">
                  <div className="role-selector-header">
                    <span>Apply groove to</span>
                    <div className="role-selector-actions">
                      <button className="mini-button" type="button" onClick={selectAllRoles}>
                        All
                      </button>
                      <button className="mini-button" type="button" onClick={selectNoRoles}>
                        None
                      </button>
                    </div>
                  </div>
                  <div className="role-toggle-grid">
                    {loadedRoleOptions.map((role) => (
                      <label
                        className="role-toggle"
                        data-active={selectedRoles[role]}
                        key={role}
                      >
                        <input
                          type="checkbox"
                          checked={selectedRoles[role]}
                          onChange={() => toggleSelectedRole(role)}
                        />
                        <span>{roleLabel(role)}</span>
                        <strong>{roleCounts[role]}</strong>
                      </label>
                    ))}
                  </div>
                </div>
              )}

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
                  onClick={reviewWriteBack}
                  disabled={
                    isBusy ||
                    events.length === 0 ||
                    !hasSelectedRoles(selectedRoleNames) ||
                    selectiveHumanizeResult.selectedCount === 0
                  }
                >
                  <Save size={17} />
                  Review Groove
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={reviewResetPattern}
                  disabled={isBusy || events.length === 0}
                  title="Review quantizing and uniform velocity before writing"
                >
                  <Undo2 size={17} />
                  Review Full Reset
                </button>
              </div>
            </section>
          </aside>

          <section className="stage workflow-step">
            <div className="stage-header">
              <div className="stage-title">
                <div className="section-title">
                  <Drum size={18} />
                  <span className="step-index">3</span>
                  <h2>Preview</h2>
                </div>
                <h3>{selectedFramework.name}</h3>
                <p>{humanizeResult.explanation}</p>
              </div>
              <div className="segmented-control" aria-label="Visualizer view">
                <button
                  type="button"
                  data-active={!showChangedOnly}
                  onClick={() => setShowChangedOnly(false)}
                >
                  All notes
                </button>
                <button
                  type="button"
                  data-active={showChangedOnly}
                  onClick={() => setShowChangedOnly(true)}
                >
                  Changed only
                </button>
              </div>
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
              <div className="summary-tile" data-warning={roleCounts.unknown > 0}>
                <span>Unknown</span>
                <strong>{roleCounts.unknown}</strong>
              </div>
            </div>

            {pendingWriteAction && (
              <div className="write-review-panel">
                <div className="write-review-copy">
                  <div className="section-title">
                    <AlertTriangle size={18} />
                    <h3>{writeActionLabel(pendingWriteAction)} Review</h3>
                  </div>
                  <p>
                    {writeActionLabel(pendingWriteAction)} will target{" "}
                    <strong>{regionStatusName(regions, selectedRegionId)}</strong> with{" "}
                    {pendingWriteAction === "reset" ? (
                      <>
                        <strong>{writeReview.totalEvents}</strong> loaded notes.
                      </>
                    ) : (
                      <>
                        <strong>{activeReviewSelectedCount}</strong> selected of{" "}
                        <strong>{writeReview.totalEvents}</strong> loaded notes.
                      </>
                    )}
                  </p>
                  {pendingWriteAction === "groove" && writeReview.unknownEvents > 0 && (
                    <div className="review-notice">
                      {selectedRoles.unknown
                        ? `${writeReview.unknownEvents} unknown roles are selected, but the groove engine leaves them unchanged.`
                        : `${writeReview.unknownEvents} unknown roles are deselected and will stay unchanged.`}
                    </div>
                  )}
                  {pendingWriteAction === "reset" && writeReview.unknownEvents > 0 && (
                    <div className="review-notice">
                      {writeReview.unknownEvents} unknown roles will reset to the detected hat
                      grid and uniform velocity.
                    </div>
                  )}
                  {writeReview.includesPatternSteps && (
                    <div className="review-warning">
                      Pattern-step regions use Audiotool's step/accent representation, so exact
                      MIDI velocity may be reduced on write.
                    </div>
                  )}
                </div>
                <div className="review-metrics">
                  <div>
                    <span>Changed</span>
                    <strong>{writeReview.changedEvents}</strong>
                  </div>
                  <div>
                    <span>Expected skipped</span>
                    <strong>{writeReview.expectedSkippedEvents}</strong>
                  </div>
                  <div>
                    <span>Max move</span>
                    <strong>{writeReview.maxShiftMs} ms</strong>
                  </div>
                  <div>
                    <span>Velocity delta</span>
                    <strong>{writeReview.maxVelocityDeltaMidi}</strong>
                  </div>
                </div>
                <div className="button-row review-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      void confirmPendingWrite();
                    }}
                    disabled={
                      isBusy ||
                      writeReview.totalEvents === 0 ||
                      (pendingWriteAction === "groove" &&
                        (!hasSelectedRoles(selectedRoleNames) ||
                          activeReviewSelectedCount === 0))
                    }
                  >
                    <Check size={17} />
                    Confirm {writeActionLabel(pendingWriteAction)}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={cancelPendingWrite}
                    title="Cancel write"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>
            )}

            <GrooveVisualizer
              originalEvents={events}
              transformedEvents={selectiveHumanizeResult.events}
              changes={selectiveHumanizeResult.changes}
              selectedRoles={selectedRoles}
              showChangedOnly={showChangedOnly}
            />

            <div className="analysis-panel">
              <div className="analysis-copy">
                <h3>Preview</h3>
                <p>{humanizeResult.explanation}</p>
              </div>
              <div className="change-list">
                {selectiveHumanizeResult.changes
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

function hasSelectedRoles(roles: readonly DrumRole[]) {
  return roles.length > 0;
}

function writeActionLabel(action: WriteSnapshotAction) {
  if (action === "reset") {
    return "Reset";
  }

  if (action === "undo") {
    return "Undo";
  }

  return "Write Groove";
}

function undoTitle(snapshot: LastWriteSnapshot<AudiotoolWriteSummary>) {
  const time = new Date(snapshot.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Undo ${writeActionLabel(snapshot.action).toLowerCase()} from ${time}`;
}

function safeFilename(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "snapshot";
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function redirectToCanonicalOrigin() {
  const canonicalOrigin = new URL(redirectUrl).origin;
  if (window.location.origin === canonicalOrigin) {
    return false;
  }

  // Preserve the path, query (OAuth callback params), and hash; only swap the origin.
  const target = new URL(window.location.href);
  const canonical = new URL(canonicalOrigin);
  target.protocol = canonical.protocol;
  target.host = canonical.host;
  window.location.replace(target.toString());
  return true;
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
