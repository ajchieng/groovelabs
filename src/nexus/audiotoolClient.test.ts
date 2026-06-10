import { describe, expect, it, vi } from "vitest";
import { TICKS_PER_BEAT } from "../types/groove";
import { AudiotoolProject, type SampleNameResolver } from "./audiotoolClient";

type Field = {
  value?: unknown;
  location?: unknown;
  array?: Field[];
  fields?: Record<string, Field>;
};

type Entity = {
  id: string;
  entityType: string;
  location?: unknown;
  fields?: Record<string, Field>;
};

const v = (value: unknown): Field => ({ value });
const arr = (items: Field[]): Field => ({ array: items });
const obj = (fields: Record<string, Field>): Field => ({ fields });

// One 16th-note step. A machiniste step plays when `isActive` is true.
function step(active: boolean): Field {
  return obj({ isActive: v(active), modulationDepth: v(1) });
}

// A 16-step channel pattern with hits at the given step indices.
function channelPattern(hitSteps: number[]): Field {
  return obj({
    steps: arr(Array.from({ length: 16 }, (_, index) => step(hitSteps.includes(index)))),
  });
}

// Minimal Audiotool document: one machiniste pattern region with three named-sample lanes
// (kick on downbeats, snare on backbeats, closed hat on every 16th).
function machinisteDocumentEntities(): Record<string, Entity[]> {
  const channelSampleLocations = [
    { s: "kick-loc" },
    { s: "snare-loc" },
    { s: "hat-loc" },
  ];

  const machiniste: Entity = {
    id: "mach1",
    entityType: "machiniste",
    location: { dev: "mach1" },
    fields: {
      channels: arr(channelSampleLocations.map((loc) => obj({ sample: { value: loc } }))),
      patternSlots: arr([{ location: { slot: 0 } }]),
    },
  };

  const machinistePattern: Entity = {
    id: "pat1",
    entityType: "machinistePattern",
    fields: {
      slot: v({ slot: 0 }),
      stepScaleIndex: v(1),
      length: v(16),
      channelPatterns: arr([
        channelPattern([0, 8]), // kick: beats 1 and 3
        channelPattern([4, 12]), // snare: beats 2 and 4 (backbeat)
        channelPattern([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), // hat: 16ths
      ]),
    },
  };

  const patternTrack: Entity = {
    id: "track1",
    entityType: "patternTrack",
    location: { trk: "track1" },
    fields: {
      player: v({ dev: "mach1" }),
      displayName: v("Machiniste"),
    },
  };

  const patternRegion: Entity = {
    id: "region1",
    entityType: "patternRegion",
    fields: {
      track: v({ trk: "track1" }),
      patternIndex: v(0),
    },
  };

  const samples: Entity[] = [
    { id: "s-kick", entityType: "sample", location: { s: "kick-loc" }, fields: { sampleName: v("samples/aaa-0000") } },
    { id: "s-snare", entityType: "sample", location: { s: "snare-loc" }, fields: { sampleName: v("samples/bbb-1111") } },
    { id: "s-hat", entityType: "sample", location: { s: "hat-loc" }, fields: { sampleName: v("samples/ccc-2222") } },
  ];

  return {
    patternRegion: [patternRegion],
    patternTrack: [patternTrack],
    machiniste: [machiniste],
    machinistePattern: [machinistePattern],
    sample: samples,
  };
}

function fakeNexus(entitiesByType: Record<string, Entity[]>) {
  return {
    start: async () => {},
    stop: async () => {},
    modify: async () => {},
    queryEntities: {
      ofTypes: (...types: string[]) => ({
        get: () => types.flatMap((type) => entitiesByType[type] ?? []),
      }),
    },
  };
}

const displayNames: Record<string, string> = {
  "samples/aaa-0000": "Kick",
  "samples/bbb-1111": "Snare",
  "samples/ccc-2222": "Closed Hat",
};

describe("AudiotoolProject sample-name resolution", () => {
  it("detects machiniste lanes from resolved sample display names", async () => {
    const resolver: SampleNameResolver = vi.fn(async (backendName) => displayNames[backendName]);
    const project = new AudiotoolProject(fakeNexus(machinisteDocumentEntities()) as never, resolver);

    const snapshot = await project.readDrumPattern();
    const byName = (name: string) => snapshot.events.filter((event) => event.padName === name);

    expect(byName("Kick").length).toBe(2);
    expect(byName("Snare").length).toBe(2);
    expect(byName("Closed Hat").length).toBe(16);

    expect(byName("Kick").every((event) => event.role === "kick")).toBe(true);
    expect(byName("Snare").every((event) => event.role === "snare")).toBe(true);
    expect(byName("Closed Hat").every((event) => event.role === "closed_hat")).toBe(true);
  });

  it("caches resolved names across reads (one lookup per unique sample)", async () => {
    const resolver: SampleNameResolver = vi.fn(async (backendName) => displayNames[backendName]);
    const project = new AudiotoolProject(fakeNexus(machinisteDocumentEntities()) as never, resolver);

    await project.readDrumPattern();
    await project.readDrumPattern();

    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it("falls back to the raw backend name when no resolver is provided", async () => {
    const project = new AudiotoolProject(fakeNexus(machinisteDocumentEntities()) as never);

    const snapshot = await project.readDrumPattern();

    expect(snapshot.events.some((event) => event.padName?.startsWith("samples/"))).toBe(true);
  });
});

// Sanity: the 16th grid lines up with beats so the rhythm-based fallbacks stay valid.
it("uses a 16th-note machiniste step grid", () => {
  expect(TICKS_PER_BEAT / 4).toBe(960);
});
