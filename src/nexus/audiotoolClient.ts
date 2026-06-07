import { audiotool } from "@audiotool/nexus";
import { TICKS_PER_BEAT, type DrumEvent, type DrumRole } from "../types/groove";
import { detectDrumRoles } from "../engine/roleDetection";
import { clamp } from "../engine/math";

type NexusField<T = unknown> = {
  value?: T;
  location?: unknown;
  fields?: Record<string, NexusField>;
  array?: readonly NexusField[];
};

type NexusEntity = {
  id: string;
  entityType?: string;
  location?: unknown;
  fields?: Record<string, NexusField>;
};

type NexusDocument = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  modify: <T>(callback: (transaction: NexusTransaction) => T | Promise<T>) => Promise<T>;
  queryEntities: {
    ofTypes: (...types: string[]) => {
      get: () => NexusEntity[];
      getOne?: () => NexusEntity | undefined;
    };
  };
};

type NexusTransaction = {
  entities: {
    ofTypes: (...types: string[]) => {
      get: () => NexusEntity[];
      getOne?: () => NexusEntity | undefined;
    };
  };
  create: (type: string, args: Record<string, unknown>) => NexusEntity;
  update: (field: NexusField, value: unknown) => void;
};

export type AudiotoolProjectSnapshot = {
  events: DrumEvent[];
  regions: AudiotoolRegion[];
  tempoBpm: number;
};

export type AudiotoolRegion = {
  id: string;
  name: string;
  noteCount: number;
  collectionKey: string;
  sourceType: "note" | "pattern";
  deviceName?: string;
  deviceType?: string;
  trackName?: string;
  stripName?: string;
};

type AudiotoolRegionContext = AudiotoolRegion & {
  player?: NexusEntity;
};

type AudiotoolPatternRegionContext = AudiotoolRegionContext & {
  pattern?: NexusEntity;
  patternIndex: number;
};

type NotePitchContext = {
  sampleName?: string;
  padName?: string;
  stripName?: string;
};

export type AudiotoolWriteSummary = {
  updated: number;
  created: number;
  skipped: number;
};

type AudiotoolWriteOptions = {
  forcePatternSixteenthGrid?: boolean;
  patternVelocity?: number;
};

export type AudiotoolSession =
  | {
      status: "unauthenticated";
      login: () => void;
      error?: string;
    }
  | {
      status: "authenticated";
      userName: string;
      logout: () => void;
      openProject: (projectUrl: string) => Promise<AudiotoolProject>;
    };

export async function createAudiotoolSession({
  clientId,
  redirectUrl,
}: {
  clientId: string;
  redirectUrl: string;
}): Promise<AudiotoolSession> {
  const at = await audiotool({
    clientId,
    redirectUrl,
    scope: "project:write",
  });

  if (at.status === "unauthenticated") {
    return {
      status: "unauthenticated",
      login: () => at.login(),
      error: at.error?.message,
    };
  }

  return {
    status: "authenticated",
    userName: at.userName,
    logout: () => at.logout(),
    openProject: async (projectUrl: string) => {
      const nexus = (await at.open(projectUrl)) as unknown as NexusDocument;
      await nexus.start();
      return new AudiotoolProject(nexus);
    },
  };
}

export class AudiotoolProject {
  constructor(private readonly nexus: NexusDocument) {}

  async close() {
    await this.nexus.stop();
  }

  async readDrumPattern(regionId?: string): Promise<AudiotoolProjectSnapshot> {
    const tempoBpm = this.readTempoBpm();
    const regionContext = this.readRegionContext();
    const selectedRegion = regionId
      ? regionContext.regions.find((region) => region.id === regionId)
      : undefined;
    const selectedCollectionKey = selectedRegion?.collectionKey;
    const selectedSourceType = selectedRegion?.sourceType;

    const notes = this.getEntities("note");
    const noteCountsByCollection = countNotesByCollection(notes);
    const sampleNamesByLocation = readSampleNamesByLocation(this.getEntities("sample"));
    const pitchContexts = buildNotePitchContexts(
      notes,
      regionContext.byCollection,
      sampleNamesByLocation,
      regionContext.stripNamesByOutput,
    );
    const noteEvents = notes
      .filter((note) => {
        if (!selectedCollectionKey || selectedSourceType !== "note") {
          return true;
        }
        const collectionLocation = readFieldValue(note, ["collection"]);
        return locationKey(collectionLocation) === selectedCollectionKey;
      })
      .map((note) => {
        const collectionLocation = readFieldValue(note, ["collection"]);
        const collectionKey = locationKey(collectionLocation);
        const context = regionContext.byCollection.get(collectionKey);
        const pitch = readOptionalNumber(note, ["pitch"]);
        const pitchContext =
          pitch === undefined ? undefined : pitchContexts.get(notePitchKey(collectionKey, pitch));

        return {
          id: note.id,
          time: readNumber(note, ["positionTicks", "position"], 0),
          pitch,
          velocity: readNumber(note, ["velocity"], 0.7),
          duration: readOptionalNumber(note, ["durationTicks", "duration"]),
          sampleName: pitchContext?.sampleName,
          padName: pitchContext?.padName,
          stripName: pitchContext?.stripName ?? context?.stripName,
          regionName: context?.name,
          trackName: context?.trackName,
          deviceName: context?.deviceName,
          deviceType: context?.deviceType,
          role: "unknown",
          confidence: 0,
          source: {
            kind: "audiotool-note",
            entityId: note.id,
            collectionLocation,
          },
        } satisfies DrumEvent;
      });
    const patternEvents = buildPatternEvents(regionContext.patternRegions, sampleNamesByLocation);
    const patternCountsByRegion = countPatternEventsByRegion(patternEvents);
    const regions = regionContext.regions.map((region) => ({
      ...region,
      noteCount:
        region.sourceType === "pattern"
          ? patternCountsByRegion.get(region.collectionKey) ?? 0
          : noteCountsByCollection.get(region.collectionKey) ?? 0,
    }));
    const events = [
      ...noteEvents.filter(
        (event) => !selectedCollectionKey || selectedSourceType !== "pattern",
      ),
      ...patternEvents.filter(
        (event) =>
          !selectedCollectionKey ||
          (selectedSourceType === "pattern" &&
            event.source?.collectionLocation === selectedCollectionKey),
      ),
    ];

    return {
      events: detectDrumRoles(events),
      regions,
      tempoBpm,
    };
  }

  async writeTransformedPattern(
    originalEvents: DrumEvent[],
    transformedEvents: DrumEvent[],
    options: AudiotoolWriteOptions = {},
  ): Promise<AudiotoolWriteSummary> {
    // Keep write-back anchored to the original source ids. The transformed list may
    // be sorted differently after timing changes, so ids are the stable link.
    const originalsById = new Map(originalEvents.map((event) => [event.id, event]));
    const transformedBySourceId = transformedEvents
      .filter((event) => event.source?.kind === "audiotool-note" && originalsById.has(event.id))
      .map((event) => [event.id, event] as const);
    const transformedPatternEvents = transformedEvents.filter(
      (event) => event.source?.kind === "audiotool-pattern-step" && originalsById.has(event.id),
    );
    const ghostEvents = transformedEvents.filter(
      (event) => event.source?.kind === "audiotool-note" && !originalsById.has(event.id),
    );
    const unsupportedEvents = transformedEvents.filter(
      (event) =>
        event.source?.kind !== "audiotool-note" &&
        event.source?.kind !== "audiotool-pattern-step" &&
        originalsById.has(event.id),
    );

    let updated = 0;
    let created = 0;
    let skipped = unsupportedEvents.length;

    await this.nexus.modify((transaction) => {
      const currentNotes = new Map(
        transaction.entities
          .ofTypes("note")
          .get()
          .map((note) => [note.id, note]),
      );
      const currentPatterns = new Map(
        transaction.entities
          .ofTypes("beatbox8Pattern", "beatbox9Pattern", "machinistePattern")
          .get()
          .map((pattern) => [pattern.id, pattern]),
      );

      for (const [sourceId, event] of transformedBySourceId) {
        const note = currentNotes.get(sourceId);
        if (!note?.fields) {
          skipped += 1;
          continue;
        }

        // Note regions can store exact tick positions and normalized velocity.
        const changedPosition = updateFirstPresent(
          transaction,
          note,
          ["positionTicks", "position"],
          Math.round(event.time),
        );
        const changedVelocity = updateIfPresent(
          transaction,
          note,
          "velocity",
          clamp(event.velocity, 0, 1),
        );
        if (event.duration !== undefined) {
          updateFirstPresent(
            transaction,
            note,
            ["durationTicks", "duration"],
            Math.round(event.duration),
          );
        }
        if (changedPosition || changedVelocity) {
          updated += 1;
        } else {
          skipped += 1;
        }
      }

      for (const event of ghostEvents) {
        const collectionLocation = event.source?.collectionLocation;
        if (!collectionLocation) {
          skipped += 1;
          continue;
        }

        transaction.create("note", {
          collection: collectionLocation,
          positionTicks: Math.round(event.time),
          pitch: Math.round(event.pitch ?? 38),
          velocity: clamp(event.velocity, 0, 1),
          durationTicks: Math.round(event.duration ?? 120),
          doesSlide: false,
        });
        created += 1;
      }

      for (const event of transformedPatternEvents) {
        // Pattern regions are drum-machine steps, so write-back maps the transformed
        // event onto the nearest target step for that specific machine type.
        if (writePatternStepEvent(transaction, currentPatterns, event, options)) {
          updated += 1;
        } else {
          skipped += 1;
        }
      }
    });

    return { updated, created, skipped };
  }

  private getEntities(...types: string[]) {
    try {
      return this.nexus.queryEntities.ofTypes(...types).get() ?? [];
    } catch {
      return [];
    }
  }

  private readTempoBpm() {
    const config = this.getEntities("config")[0];
    return readNumber(config, ["bpm", "tempo", "tempoBpm"], 90);
  }

  private readRegionContext() {
    const regions = this.getEntities("noteRegion");
    const patternRegions = this.getEntities("patternRegion");
    const tracksByLocation = new Map(
      this.getEntities("noteTrack").map((track) => [locationKey(track.location), track]),
    );
    const patternTracksByLocation = new Map(
      this.getEntities("patternTrack").map((track) => [locationKey(track.location), track]),
    );
    const devicesByLocation = new Map(
      this.getEntities(...PLAYER_TYPES).map((device) => [locationKey(device.location), device]),
    );
    const patternsBySlot = new Map(
      this.getEntities("beatbox8Pattern", "beatbox9Pattern", "machinistePattern").map(
        (pattern) => [locationKey(readFieldValue(pattern, ["slot"])), pattern],
      ),
    );
    const stripNamesByOutput = this.readMixerStripNamesByOutput();
    const byCollection = new Map<string, AudiotoolRegionContext>();
    const patternRegionList: AudiotoolPatternRegionContext[] = [];
    const regionList: AudiotoolRegion[] = [];

    for (const [index, region] of regions.entries()) {
      const collectionLocation = readFieldValue(region, ["collection", "noteCollection"]);
      const collectionKey = locationKey(collectionLocation);
      const trackLocation = readFieldValue(region, ["track"]);
      const track = tracksByLocation.get(locationKey(trackLocation));
      const playerLocation = readFieldValue(track, ["player"]);
      const player = devicesByLocation.get(locationKey(playerLocation));
      const deviceType = entityType(player);
      const stripName = readDeviceStripName(player, stripNamesByOutput);
      const trackName = readString(track, ["displayName", "name"]);
      const deviceName =
        readString(player, ["displayName", "presetName", "name"]) ??
        stripName ??
        trackName;
      const name =
        readString(region, ["displayName", "name"]) ??
        trackName ??
        stripName ??
        deviceName ??
        `Region ${index + 1}`;

      const publicRegion = {
        id: region.id,
        name,
        noteCount: 0,
        collectionKey,
        sourceType: "note",
        deviceName,
        deviceType,
        trackName,
        stripName,
      } satisfies AudiotoolRegion;
      const regionInfo = {
        ...publicRegion,
        player,
      } satisfies AudiotoolRegionContext;

      regionList.push(publicRegion);
      if (collectionKey) {
        byCollection.set(collectionKey, regionInfo);
      }
    }

    for (const [index, region] of patternRegions.entries()) {
      const trackLocation = readFieldValue(region, ["track"]);
      const track = patternTracksByLocation.get(locationKey(trackLocation));
      const playerLocation = readFieldValue(track, ["player"]);
      const player = devicesByLocation.get(locationKey(playerLocation));
      const deviceType = entityType(player);
      if (!isSupportedPatternDevice(deviceType)) {
        continue;
      }

      const patternIndex = readNumber(region, ["patternIndex"], 0);
      const patternSlot = readNestedArray(player, ["patternSlots"])[patternIndex];
      const pattern = patternsBySlot.get(locationKey(patternSlot?.location));
      const collectionKey = `pattern:${region.id}`;
      const stripName = readDeviceStripName(player, stripNamesByOutput);
      const trackName = readString(track, ["displayName", "name"]);
      const deviceName =
        readString(player, ["displayName", "presetName", "name"]) ??
        stripName ??
        trackName;
      const name =
        readNestedString(region, ["region", "displayName"]) ??
        trackName ??
        stripName ??
        deviceName ??
        `Pattern ${index + 1}`;
      const publicRegion = {
        id: collectionKey,
        name,
        noteCount: 0,
        collectionKey,
        sourceType: "pattern",
        deviceName,
        deviceType,
        trackName,
        stripName,
      } satisfies AudiotoolRegion;
      const regionInfo = {
        ...publicRegion,
        pattern,
        patternIndex,
        player,
      } satisfies AudiotoolPatternRegionContext;

      regionList.push(publicRegion);
      patternRegionList.push(regionInfo);
    }

    return {
      byCollection,
      patternRegions: patternRegionList,
      regions: regionList,
      stripNamesByOutput,
    };
  }

  private readMixerStripNamesByOutput() {
    const stripNamesByInput = new Map<string, string>();
    for (const strip of this.getEntities("mixerChannel")) {
      const inputKey = locationKey(strip.fields?.audioInput?.location);
      const stripName = readNestedString(strip, ["displayParameters", "displayName"]);
      if (inputKey && stripName) {
        stripNamesByInput.set(inputKey, stripName);
      }
    }

    const stripNamesByOutput = new Map<string, string>();
    for (const cable of this.getEntities("desktopAudioCable")) {
      const fromKey = locationKey(readFieldValue(cable, ["fromSocket"]));
      const toKey = locationKey(readFieldValue(cable, ["toSocket"]));
      const stripName = stripNamesByInput.get(toKey);
      if (fromKey && stripName) {
        stripNamesByOutput.set(fromKey, stripName);
      }
    }

    return stripNamesByOutput;
  }
}

function countNotesByCollection(notes: NexusEntity[]) {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const collectionKey = locationKey(readFieldValue(note, ["collection"]));
    if (collectionKey) {
      counts.set(collectionKey, (counts.get(collectionKey) ?? 0) + 1);
    }
  }
  return counts;
}

function countPatternEventsByRegion(events: DrumEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = String(event.source?.collectionLocation ?? "");
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

type DrumLaneDefinition = {
  name: string;
  fieldKey?: string;
};

type PatternInstrument = {
  fieldName: string;
  name: string;
  pitch: number;
  role: DrumRole;
};

const BEATBOX8_LANES: DrumLaneDefinition[] = [
  { name: "Bassdrum", fieldKey: "bassdrum" },
  { name: "Snaredrum", fieldKey: "snaredrum" },
  { name: "Low Tom", fieldKey: "tomCongaLow" },
  { name: "Mid Tom", fieldKey: "tomCongaMid" },
  { name: "High Tom", fieldKey: "tomCongaHigh" },
  { name: "Rimshot", fieldKey: "rimClaves" },
  { name: "Clap", fieldKey: "clapMaracas" },
  { name: "Cowbell", fieldKey: "cowbell" },
  { name: "Cymbal", fieldKey: "cymbal" },
  { name: "Open Hihat", fieldKey: "openHihat" },
  { name: "Closed Hihat", fieldKey: "closedHihat" },
];

const BEATBOX9_LANES: DrumLaneDefinition[] = [
  { name: "Bassdrum", fieldKey: "bassdrum" },
  { name: "Snaredrum", fieldKey: "snaredrum" },
  { name: "Low Tom", fieldKey: "tomLow" },
  { name: "Mid Tom", fieldKey: "tomMid" },
  { name: "High Tom", fieldKey: "tomHigh" },
  { name: "Rimshot", fieldKey: "rim" },
  { name: "Clap", fieldKey: "clap" },
  { name: "Closed Hihat", fieldKey: "hihat" },
  { name: "Open Hihat", fieldKey: "hihat" },
  { name: "Crash", fieldKey: "crash" },
  { name: "Ride", fieldKey: "ride" },
];

const FIXED_DRUM_LANES_BY_DEVICE_TYPE: Record<string, DrumLaneDefinition[]> = {
  beatbox8: BEATBOX8_LANES,
  beatbox9: BEATBOX9_LANES,
};

const MACHINISTE_CHANNEL_COUNT = 9;
const PATTERN_DEVICE_TYPES = new Set(["beatbox8", "beatbox9", "machiniste"]);
const BEATBOX_STEP_TICKS_BY_SCALE_INDEX: Record<number, number> = {
  1: 640,
  2: 1280,
  3: 960,
  4: 480,
};
const MACHINISTE_STEP_TICKS_BY_SCALE_INDEX: Record<number, number> = {
  1: 960,
  2: 480,
  3: 1280,
  4: 640,
};

const BEATBOX8_PATTERN_INSTRUMENTS: PatternInstrument[] = [
  { fieldName: "bassdrumIsActive", name: "Bassdrum", pitch: 36, role: "kick" },
  { fieldName: "snaredrumIsActive", name: "Snaredrum", pitch: 38, role: "snare" },
  { fieldName: "rimClavesIsActive", name: "Rimshot", pitch: 37, role: "snare" },
  { fieldName: "clapMaracasIsActive", name: "Clap", pitch: 39, role: "clap" },
  { fieldName: "openHihatIsActive", name: "Open Hihat", pitch: 46, role: "open_hat" },
  { fieldName: "closedHihatIsActive", name: "Closed Hihat", pitch: 42, role: "closed_hat" },
  { fieldName: "tomCongaLowIsActive", name: "Low Tom", pitch: 45, role: "perc" },
  { fieldName: "tomCongaMidIsActive", name: "Mid Tom", pitch: 47, role: "perc" },
  { fieldName: "tomCongaHighIsActive", name: "High Tom", pitch: 50, role: "perc" },
  { fieldName: "cowbellIsActive", name: "Cowbell", pitch: 56, role: "perc" },
  { fieldName: "cymbalIsActive", name: "Cymbal", pitch: 49, role: "perc" },
];

const BEATBOX9_PATTERN_INSTRUMENTS: PatternInstrument[] = [
  { fieldName: "bassdrumStepIndex", name: "Bassdrum", pitch: 36, role: "kick" },
  { fieldName: "snaredrumStepIndex", name: "Snaredrum", pitch: 38, role: "snare" },
  { fieldName: "rimStepIndex", name: "Rimshot", pitch: 37, role: "snare" },
  { fieldName: "clapStepIndex", name: "Clap", pitch: 39, role: "clap" },
  { fieldName: "closedHihatStepIndex", name: "Closed Hihat", pitch: 42, role: "closed_hat" },
  { fieldName: "openHihatStepIndex", name: "Open Hihat", pitch: 46, role: "open_hat" },
  { fieldName: "tomLowStepIndex", name: "Low Tom", pitch: 45, role: "perc" },
  { fieldName: "tomMidStepIndex", name: "Mid Tom", pitch: 47, role: "perc" },
  { fieldName: "tomHighStepIndex", name: "High Tom", pitch: 50, role: "perc" },
  { fieldName: "crashStepIndex", name: "Crash", pitch: 49, role: "perc" },
  { fieldName: "rideStepIndex", name: "Ride", pitch: 51, role: "perc" },
];

function buildPatternEvents(
  regions: AudiotoolPatternRegionContext[],
  sampleNamesByLocation: Map<string, string>,
) {
  return regions.flatMap((region) => {
    switch (region.deviceType) {
      case "beatbox8":
        return buildBeatbox8PatternEvents(region);
      case "beatbox9":
        return buildBeatbox9PatternEvents(region);
      case "machiniste":
        return buildMachinistePatternEvents(region, sampleNamesByLocation);
      default:
        return [];
    }
  });
}

function buildBeatbox8PatternEvents(region: AudiotoolPatternRegionContext) {
  if (!region.pattern) {
    return [];
  }

  const stepTicks =
    BEATBOX_STEP_TICKS_BY_SCALE_INDEX[readNumber(region.pattern, ["stepScaleIndex"], 3)] ??
    960;
  const length = readPatternLength(region.pattern, 64);
  const steps = readNestedArray(region.pattern, ["steps"]).slice(0, length);
  const events: DrumEvent[] = [];

  for (const [stepIndex, step] of steps.entries()) {
    const velocity = readBoolean(step, ["isAccented"]) ? 0.9 : 0.68;
    for (const instrument of BEATBOX8_PATTERN_INSTRUMENTS) {
      if (readBoolean(step, [instrument.fieldName])) {
        events.push(makePatternEvent(region, instrument, stepIndex, stepTicks, velocity));
      }
    }
  }

  return events;
}

function buildBeatbox9PatternEvents(region: AudiotoolPatternRegionContext) {
  if (!region.pattern) {
    return [];
  }

  const stepTicks =
    BEATBOX_STEP_TICKS_BY_SCALE_INDEX[readNumber(region.pattern, ["stepScaleIndex"], 3)] ??
    960;
  const length = readPatternLength(region.pattern, 64);
  const steps = readNestedArray(region.pattern, ["steps"]).slice(0, length);
  const events: DrumEvent[] = [];

  for (const [stepIndex, step] of steps.entries()) {
    for (const instrument of BEATBOX9_PATTERN_INSTRUMENTS) {
      const stepValue = readNumber(step, [instrument.fieldName], 0);
      if (stepValue > 0) {
        events.push(
          makePatternEvent(region, instrument, stepIndex, stepTicks, stepValue >= 2 ? 0.9 : 0.68),
        );
      }
    }
  }

  return events;
}

function buildMachinistePatternEvents(
  region: AudiotoolPatternRegionContext,
  sampleNamesByLocation: Map<string, string>,
) {
  if (!region.pattern || !region.player) {
    return [];
  }

  const stepTicks =
    MACHINISTE_STEP_TICKS_BY_SCALE_INDEX[readNumber(region.pattern, ["stepScaleIndex"], 1)] ??
    960;
  const length = readPatternLength(region.pattern, 128);
  const channelPatterns = readNestedArray(region.pattern, ["channelPatterns"]);
  const channels = readNestedArray(region.player, ["channels"]);
  const events: DrumEvent[] = [];

  for (const [channelIndex, channelPattern] of channelPatterns.entries()) {
    const channel = channels[channelIndex];
    const sampleName = sampleNamesByLocation.get(
      locationKey(readFieldValue(channel, ["sample"])),
    );
    const padName = sampleName ?? `Machiniste channel ${channelIndex + 1}`;
    const steps = readNestedArray(channelPattern, ["steps"]).slice(0, length);

    for (const [stepIndex, step] of steps.entries()) {
      if (!readBoolean(step, ["isActive"])) {
        continue;
      }

      events.push({
        id: `${region.id}:ch-${channelIndex}:step-${stepIndex}`,
        time: stepIndex * stepTicks,
        duration: Math.max(1, Math.round(stepTicks * 0.8)),
        pitch: 60 + channelIndex,
        velocity: clamp(readNumber(step, ["modulationDepth"], 1), 0.2, 1),
        sampleName,
        padName,
        stripName: region.stripName,
        regionName: region.name,
        trackName: region.trackName,
        deviceName: region.deviceName,
        deviceType: region.deviceType,
        role: "unknown",
        confidence: 0,
        source: {
          kind: "audiotool-pattern-step",
          entityId: region.pattern.id,
          collectionLocation: region.collectionKey,
          raw: { channelIndex, stepIndex, patternIndex: region.patternIndex },
        },
      });
    }
  }

  return events;
}

function makePatternEvent(
  region: AudiotoolPatternRegionContext,
  instrument: PatternInstrument,
  stepIndex: number,
  stepTicks: number,
  velocity: number,
): DrumEvent {
  return {
    id: `${region.id}:${instrument.fieldName}:step-${stepIndex}`,
    time: stepIndex * stepTicks,
    duration: Math.max(1, Math.round(stepTicks * 0.8)),
    pitch: instrument.pitch,
    velocity,
    padName: instrument.name,
    stripName: region.stripName,
    regionName: region.name,
    trackName: region.trackName,
    deviceName: region.deviceName,
    deviceType: region.deviceType,
    role: instrument.role,
    confidence: 1,
    source: {
      kind: "audiotool-pattern-step",
      entityId: region.pattern?.id,
      collectionLocation: region.collectionKey,
      raw: { stepIndex, patternIndex: region.patternIndex, fieldName: instrument.fieldName },
    },
  };
}

function readPatternLength(pattern: NexusEntity, fallback: number) {
  return Math.max(0, Math.min(fallback, Math.round(readNumber(pattern, ["length"], fallback))));
}

function readSampleNamesByLocation(samples: NexusEntity[]) {
  const sampleNames = new Map<string, string>();

  for (const sample of samples) {
    const key = locationKey(sample.location);
    const sampleName = readString(sample, ["displayName", "sampleName", "name"]);
    if (key && sampleName) {
      sampleNames.set(key, sampleName);
    }
  }

  return sampleNames;
}

function buildNotePitchContexts(
  notes: NexusEntity[],
  regionsByCollection: Map<string, AudiotoolRegionContext>,
  sampleNamesByLocation: Map<string, string>,
  stripNamesByOutput: Map<string, string>,
) {
  const pitchesByCollection = new Map<string, Set<number>>();

  for (const note of notes) {
    const collectionKey = locationKey(readFieldValue(note, ["collection"]));
    const pitch = readOptionalNumber(note, ["pitch"]);
    if (!collectionKey || pitch === undefined) {
      continue;
    }
    if (!pitchesByCollection.has(collectionKey)) {
      pitchesByCollection.set(collectionKey, new Set());
    }
    pitchesByCollection.get(collectionKey)?.add(Math.round(pitch));
  }

  const pitchContexts = new Map<string, NotePitchContext>();

  for (const [collectionKey, pitches] of pitchesByCollection) {
    const regionContext = regionsByCollection.get(collectionKey);
    if (!regionContext?.player) {
      continue;
    }

    const deviceContexts = createDevicePitchContexts(
      regionContext.player,
      [...pitches].sort((a, b) => a - b),
      sampleNamesByLocation,
      stripNamesByOutput,
    );
    for (const [pitch, context] of deviceContexts) {
      pitchContexts.set(notePitchKey(collectionKey, pitch), context);
    }
  }

  return pitchContexts;
}

function createDevicePitchContexts(
  player: NexusEntity,
  pitches: number[],
  sampleNamesByLocation: Map<string, string>,
  stripNamesByOutput: Map<string, string>,
) {
  const type = entityType(player);
  if (!type) {
    return new Map<number, NotePitchContext>();
  }

  const fixedLanes = FIXED_DRUM_LANES_BY_DEVICE_TYPE[type];
  if (fixedLanes) {
    return createFixedLanePitchContexts(player, pitches, fixedLanes, stripNamesByOutput);
  }

  if (type === "machiniste") {
    return createMachinistePitchContexts(
      player,
      pitches,
      sampleNamesByLocation,
      stripNamesByOutput,
    );
  }

  return new Map<number, NotePitchContext>();
}

function createFixedLanePitchContexts(
  player: NexusEntity,
  pitches: number[],
  lanes: DrumLaneDefinition[],
  stripNamesByOutput: Map<string, string>,
) {
  const mappedIndexes = mapPitchesToLaneIndexes(pitches, lanes.length);
  const pitchContexts = new Map<number, NotePitchContext>();

  for (const [pitch, laneIndex] of mappedIndexes) {
    const lane = lanes[laneIndex];
    if (!lane) {
      continue;
    }

    const laneStripName = lane.fieldKey
      ? readStripNameForOutput(player, [lane.fieldKey, "audioOutput"], stripNamesByOutput)
      : undefined;
    pitchContexts.set(pitch, {
      padName: lane.name,
      stripName: laneStripName,
    });
  }

  return pitchContexts;
}

function createMachinistePitchContexts(
  player: NexusEntity,
  pitches: number[],
  sampleNamesByLocation: Map<string, string>,
  stripNamesByOutput: Map<string, string>,
) {
  const mappedIndexes = mapPitchesToLaneIndexes(pitches, MACHINISTE_CHANNEL_COUNT);
  const channels = readNestedArray(player, ["channels"]);
  const pitchContexts = new Map<number, NotePitchContext>();

  for (const [pitch, channelIndex] of mappedIndexes) {
    const channel = channels[channelIndex];
    const stripName = readStripNameForOutput(channel, ["channelOutput"], stripNamesByOutput);
    const sampleLocation = readFieldValue(channel, ["sample"]);
    const sampleName = sampleNamesByLocation.get(locationKey(sampleLocation));

    pitchContexts.set(pitch, {
      sampleName,
      padName: stripName ?? sampleName ?? `Machiniste channel ${channelIndex + 1}`,
      stripName,
    });
  }

  return pitchContexts;
}

function mapPitchesToLaneIndexes(pitches: number[], laneCount: number) {
  const base = chooseLanePitchBase(pitches, laneCount);
  const mapped = new Map<number, number>();

  if (base === undefined) {
    if (pitches.length >= Math.min(6, laneCount)) {
      pitches.slice(0, laneCount).forEach((pitch, index) => mapped.set(pitch, index));
    }
    return mapped;
  }

  for (const pitch of pitches) {
    const laneIndex = pitch - base;
    if (laneIndex >= 0 && laneIndex < laneCount) {
      mapped.set(pitch, laneIndex);
    }
  }

  return mapped;
}

function chooseLanePitchBase(pitches: number[], laneCount: number) {
  if (pitches.length === 0) {
    return undefined;
  }

  const minPitch = Math.min(...pitches);
  const candidateBases = [0, 1, 12, 13, 24, 25, 48, 49, 60, 61];
  let best: { base: number; count: number; score: number } | undefined;

  for (const base of candidateBases) {
    const count = pitches.filter((pitch) => {
      const laneIndex = pitch - base;
      return laneIndex >= 0 && laneIndex < laneCount;
    }).length;
    const exactStartBonus = minPitch === base ? 3 : 0;
    const score = count * 10 + exactStartBonus;
    if (count > 0 && (!best || score > best.score)) {
      best = { base, count, score };
    }
  }

  if (!best) {
    return undefined;
  }

  const requiredMatches = pitches.length >= 4 ? Math.ceil(pitches.length * 0.6) : pitches.length;
  return best.count >= requiredMatches ? best.base : undefined;
}

function notePitchKey(collectionKey: string, pitch: number) {
  return `${collectionKey}:${Math.round(pitch)}`;
}

const PLAYER_TYPES = [
  "audioDevice",
  "bassline",
  "beatbox8",
  "beatbox9",
  "gakki",
  "heisenberg",
  "kobolt",
  "machiniste",
  "pulverisateur",
  "rasselbock",
  "space",
  "tonematrix",
];

function isSupportedPatternDevice(deviceType: string | undefined) {
  return deviceType !== undefined && PATTERN_DEVICE_TYPES.has(deviceType);
}

function writePatternStepEvent(
  transaction: NexusTransaction,
  patternsById: Map<string, NexusEntity>,
  event: DrumEvent,
  options: AudiotoolWriteOptions,
) {
  const patternId = event.source?.entityId;
  const raw = readPatternStepRaw(event);
  if (!patternId || !raw) {
    return false;
  }

  const pattern = patternsById.get(patternId);
  const type = entityType(pattern);
  if (!pattern || !type) {
    return false;
  }

  switch (type) {
    case "beatbox8":
      return writeBeatbox8StepEvent(transaction, pattern, event, raw, options);
    case "beatbox9":
      return writeBeatbox9StepEvent(transaction, pattern, event, raw, options);
    case "machiniste":
      return writeMachinisteStepEvent(transaction, pattern, event, raw, options);
    default:
      return false;
  }
}

function writeBeatbox8StepEvent(
  transaction: NexusTransaction,
  pattern: NexusEntity,
  event: DrumEvent,
  raw: PatternStepRaw,
  options: AudiotoolWriteOptions,
) {
  if (raw.stepIndex === undefined || !raw.fieldName) {
    return false;
  }

  const stepTicks = patternStepTicks(pattern, "beatbox8", options);
  const steps = readNestedArray(pattern, ["steps"]);
  const targetStepIndex = targetPatternStepIndex(event.time, stepTicks, steps.length);
  if (targetStepIndex === undefined) {
    return false;
  }

  if (options.forcePatternSixteenthGrid) {
    updateIfPresent(transaction, pattern, "stepScaleIndex", 3);
  }

  // Beatbox 8 stores each instrument as a boolean lane plus one shared accent flag
  // per step, so exact MIDI velocity is reduced to normal/accent.
  const oldStep = steps[raw.stepIndex];
  const targetStep = steps[targetStepIndex];
  if (!targetStep) {
    return false;
  }

  if (raw.stepIndex !== targetStepIndex) {
    updateIfPresent(transaction, oldStep, raw.fieldName, false);
  }
  updateIfPresent(transaction, targetStep, raw.fieldName, true);
  updateIfPresent(transaction, targetStep, "isAccented", shouldAccentPatternStep(event, options));
  return true;
}

function writeBeatbox9StepEvent(
  transaction: NexusTransaction,
  pattern: NexusEntity,
  event: DrumEvent,
  raw: PatternStepRaw,
  options: AudiotoolWriteOptions,
) {
  if (raw.stepIndex === undefined || !raw.fieldName) {
    return false;
  }

  const stepTicks = patternStepTicks(pattern, "beatbox9", options);
  const steps = readNestedArray(pattern, ["steps"]);
  const targetStepIndex = targetPatternStepIndex(event.time, stepTicks, steps.length);
  if (targetStepIndex === undefined) {
    return false;
  }

  if (options.forcePatternSixteenthGrid) {
    updateIfPresent(transaction, pattern, "stepScaleIndex", 3);
  }

  // Beatbox 9 stores instrument values as 0/1/2. That gives off, normal, accent,
  // but not continuous MIDI-style velocity.
  const oldStep = steps[raw.stepIndex];
  const targetStep = steps[targetStepIndex];
  if (!targetStep) {
    return false;
  }

  if (raw.stepIndex !== targetStepIndex) {
    updateIfPresent(transaction, oldStep, raw.fieldName, 0);
  }
  updateIfPresent(transaction, targetStep, raw.fieldName, shouldAccentPatternStep(event, options) ? 2 : 1);
  return true;
}

function writeMachinisteStepEvent(
  transaction: NexusTransaction,
  pattern: NexusEntity,
  event: DrumEvent,
  raw: PatternStepRaw,
  options: AudiotoolWriteOptions,
) {
  if (raw.channelIndex === undefined || raw.stepIndex === undefined) {
    return false;
  }

  const stepTicks = patternStepTicks(pattern, "machiniste", options);
  const channelPattern = readNestedArray(pattern, ["channelPatterns"])[raw.channelIndex];
  const steps = readNestedArray(channelPattern, ["steps"]);
  const targetStepIndex = targetPatternStepIndex(event.time, stepTicks, steps.length);
  if (targetStepIndex === undefined) {
    return false;
  }

  if (options.forcePatternSixteenthGrid) {
    updateIfPresent(transaction, pattern, "stepScaleIndex", 1);
  }

  // Machiniste has a modulationDepth field, so it preserves more continuous velocity
  // detail than Beatbox pattern lanes.
  const oldStep = steps[raw.stepIndex];
  const targetStep = steps[targetStepIndex];
  if (!targetStep) {
    return false;
  }

  if (raw.stepIndex !== targetStepIndex) {
    updateIfPresent(transaction, oldStep, "isActive", false);
  }
  updateIfPresent(transaction, targetStep, "isActive", true);
  updateIfPresent(transaction, targetStep, "modulationDepth", patternStepVelocity(event, options));
  return true;
}

type PatternStepRaw = {
  channelIndex?: number;
  fieldName?: string;
  stepIndex?: number;
};

function readPatternStepRaw(event: DrumEvent): PatternStepRaw | undefined {
  const raw = event.source?.raw;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const values = raw as Record<string, unknown>;
  return {
    channelIndex: readRawInteger(values.channelIndex),
    fieldName: typeof values.fieldName === "string" ? values.fieldName : undefined,
    stepIndex: readRawInteger(values.stepIndex),
  };
}

function readRawInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function patternStepTicks(
  pattern: NexusEntity,
  deviceType: "beatbox8" | "beatbox9" | "machiniste",
  options: AudiotoolWriteOptions,
) {
  if (options.forcePatternSixteenthGrid) {
    return TICKS_PER_BEAT / 4;
  }

  if (deviceType === "machiniste") {
    return MACHINISTE_STEP_TICKS_BY_SCALE_INDEX[readNumber(pattern, ["stepScaleIndex"], 1)] ?? 960;
  }

  return BEATBOX_STEP_TICKS_BY_SCALE_INDEX[readNumber(pattern, ["stepScaleIndex"], 3)] ?? 960;
}

function targetPatternStepIndex(time: number, stepTicks: number, stepCount: number) {
  const stepIndex = Math.round(time / stepTicks);
  return stepIndex >= 0 && stepIndex < stepCount ? stepIndex : undefined;
}

function patternStepVelocity(event: DrumEvent, options: AudiotoolWriteOptions) {
  return clamp(options.patternVelocity ?? event.velocity, 0.2, 1);
}

function shouldAccentPatternStep(event: DrumEvent, options: AudiotoolWriteOptions) {
  return patternStepVelocity(event, options) >= 0.79;
}

function updateIfPresent(
  transaction: NexusTransaction,
  entity: NexusFieldContainer,
  fieldName: string,
  value: unknown,
) {
  const field = entity?.fields?.[fieldName];
  if (field) {
    transaction.update(field, value);
    return true;
  }
  return false;
}

function updateFirstPresent(
  transaction: NexusTransaction,
  entity: NexusEntity,
  fieldNames: string[],
  value: unknown,
) {
  for (const fieldName of fieldNames) {
    if (updateIfPresent(transaction, entity, fieldName, value)) {
      return true;
    }
  }
  return false;
}

type NexusFieldContainer = NexusEntity | NexusField | undefined;

function readFieldValue<T = unknown>(entity: NexusFieldContainer, names: string[]) {
  if (!entity?.fields) {
    return undefined;
  }

  for (const name of names) {
    if (name in entity.fields) {
      return entity.fields[name].value as T;
    }
  }

  return undefined;
}

function readOptionalNumber(entity: NexusFieldContainer, names: string[]) {
  const value = readFieldValue(entity, names);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNumber(entity: NexusFieldContainer, names: string[], fallback: number) {
  return readOptionalNumber(entity, names) ?? fallback;
}

function readBoolean(entity: NexusFieldContainer, names: string[]) {
  const value = readFieldValue(entity, names);
  return value === true;
}

function readString(entity: NexusFieldContainer, names: string[]) {
  const value = readFieldValue(entity, names);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNestedField(entity: NexusFieldContainer, path: string[]): NexusField | undefined {
  let current = entity;

  for (const name of path) {
    current = current?.fields?.[name];
    if (!current) {
      return undefined;
    }
  }

  return current;
}

function readNestedString(entity: NexusFieldContainer, path: string[]) {
  const value = readNestedField(entity, path)?.value;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNestedArray(entity: NexusFieldContainer, path: string[]) {
  return readNestedField(entity, path)?.array ?? [];
}

function readStripNameForOutput(
  entity: NexusFieldContainer,
  path: string[],
  stripNamesByOutput: Map<string, string>,
) {
  return stripNamesByOutput.get(locationKey(readNestedField(entity, path)?.location));
}

function readDeviceStripName(
  player: NexusEntity | undefined,
  stripNamesByOutput: Map<string, string>,
) {
  return (
    readStripNameForOutput(player, ["audioOutput"], stripNamesByOutput) ??
    readStripNameForOutput(player, ["mainOutput"], stripNamesByOutput)
  );
}

function entityType(entity: NexusEntity | undefined) {
  return typeof entity?.entityType === "string" && entity.entityType.length > 0
    ? entity.entityType
    : undefined;
}

function locationKey(location: unknown) {
  if (!location) {
    return "";
  }

  try {
    return JSON.stringify(location);
  } catch {
    return String(location);
  }
}
