import { audiotool } from "@audiotool/nexus";
import type { DrumEvent } from "../types/groove";
import { detectDrumRoles } from "../engine/roleDetection";
import { clamp } from "../engine/math";

type NexusField<T = unknown> = {
  value?: T;
  location?: unknown;
};

type NexusEntity = {
  id: string;
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
  tempoBpm: number;
};

export type AudiotoolWriteSummary = {
  updated: number;
  created: number;
  skipped: number;
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

  async readDrumPattern(): Promise<AudiotoolProjectSnapshot> {
    const tempoBpm = this.readTempoBpm();
    const collectionContext = this.readCollectionContext();

    const events = this.getEntities("note").map((note) => {
      const collectionLocation = readFieldValue(note, ["collection"]);
      const context = collectionContext.get(locationKey(collectionLocation));

      return {
        id: note.id,
        time: readNumber(note, ["positionTicks", "position"], 0),
        pitch: readOptionalNumber(note, ["pitch"]),
        velocity: readNumber(note, ["velocity"], 0.7),
        duration: readOptionalNumber(note, ["durationTicks", "duration"]),
        sampleName: context?.sampleName,
        padName: context?.padName,
        deviceName: context?.deviceName,
        role: "unknown",
        confidence: 0,
        source: {
          kind: "audiotool-note",
          entityId: note.id,
          collectionLocation,
        },
      } satisfies DrumEvent;
    });

    return {
      events: detectDrumRoles(events),
      tempoBpm,
    };
  }

  async writeTransformedPattern(
    originalEvents: DrumEvent[],
    transformedEvents: DrumEvent[],
  ): Promise<AudiotoolWriteSummary> {
    const originalsById = new Map(originalEvents.map((event) => [event.id, event]));
    const transformedBySourceId = transformedEvents
      .filter((event) => event.source?.kind === "audiotool-note" && originalsById.has(event.id))
      .map((event) => [event.id, event] as const);
    const ghostEvents = transformedEvents.filter(
      (event) => event.source?.kind === "audiotool-note" && !originalsById.has(event.id),
    );

    let updated = 0;
    let created = 0;
    let skipped = 0;

    await this.nexus.modify((transaction) => {
      const currentNotes = new Map(
        transaction.entities
          .ofTypes("note")
          .get()
          .map((note) => [note.id, note]),
      );

      for (const [sourceId, event] of transformedBySourceId) {
        const note = currentNotes.get(sourceId);
        if (!note?.fields) {
          skipped += 1;
          continue;
        }

        updateIfPresent(transaction, note, "positionTicks", Math.round(event.time));
        updateIfPresent(transaction, note, "velocity", clamp(event.velocity, 0, 1));
        if (event.duration !== undefined) {
          updateIfPresent(transaction, note, "durationTicks", Math.round(event.duration));
        }
        updated += 1;
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
    });

    return { updated, created, skipped };
  }

  async writeVelocities(
    originalEvents: DrumEvent[],
    transformedEvents: DrumEvent[],
  ): Promise<AudiotoolWriteSummary> {
    const originalIds = new Set(originalEvents.map((event) => event.id));
    const transformedBySourceId = transformedEvents
      .filter((event) => event.source?.kind === "audiotool-note" && originalIds.has(event.id))
      .map((event) => [event.id, event] as const);

    let updated = 0;
    let skipped = 0;

    await this.nexus.modify((transaction) => {
      const currentNotes = new Map(
        transaction.entities
          .ofTypes("note")
          .get()
          .map((note) => [note.id, note]),
      );

      for (const [sourceId, event] of transformedBySourceId) {
        const note = currentNotes.get(sourceId);
        if (!note?.fields) {
          skipped += 1;
          continue;
        }

        if (updateIfPresent(transaction, note, "velocity", clamp(event.velocity, 0, 1))) {
          updated += 1;
        } else {
          skipped += 1;
        }
      }
    });

    return { updated, created: 0, skipped };
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

  private readCollectionContext() {
    const regions = this.getEntities("noteRegion");
    const tracksByLocation = new Map(
      this.getEntities("noteTrack").map((track) => [locationKey(track.location), track]),
    );
    const devicesByLocation = new Map(
      this.getEntities(...NOTE_PLAYER_TYPES).map((device) => [locationKey(device.location), device]),
    );
    const contextByCollection = new Map<
      string,
      { sampleName?: string; padName?: string; deviceName?: string }
    >();

    for (const region of regions) {
      const collectionLocation = readFieldValue(region, ["collection", "noteCollection"]);
      const trackLocation = readFieldValue(region, ["track"]);
      const track = tracksByLocation.get(locationKey(trackLocation));
      const playerLocation = readFieldValue(track, ["player"]);
      const player = devicesByLocation.get(locationKey(playerLocation));

      contextByCollection.set(locationKey(collectionLocation), {
        padName: readString(region, ["displayName", "name"]),
        sampleName: readString(region, ["displayName", "name"]),
        deviceName:
          readString(player, ["displayName", "presetName", "name"]) ??
          readString(track, ["displayName", "name"]),
      });
    }

    return contextByCollection;
  }
}

const NOTE_PLAYER_TYPES = [
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

function updateIfPresent(
  transaction: NexusTransaction,
  entity: NexusEntity,
  fieldName: string,
  value: unknown,
) {
  const field = entity.fields?.[fieldName];
  if (field) {
    transaction.update(field, value);
    return true;
  }
  return false;
}

function readFieldValue<T = unknown>(entity: NexusEntity | undefined, names: string[]) {
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

function readOptionalNumber(entity: NexusEntity | undefined, names: string[]) {
  const value = readFieldValue(entity, names);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNumber(entity: NexusEntity | undefined, names: string[], fallback: number) {
  return readOptionalNumber(entity, names) ?? fallback;
}

function readString(entity: NexusEntity | undefined, names: string[]) {
  const value = readFieldValue(entity, names);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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
