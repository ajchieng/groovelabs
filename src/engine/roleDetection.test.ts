import { describe, expect, it } from "vitest";
import { TICKS_PER_BEAT, type DrumEvent } from "../types/groove";
import { detectDrumRoles } from "./roleDetection";

describe("detectDrumRoles", () => {
  it("uses strip and pad names to classify non-GM drum-machine notes", () => {
    const detected = detectDrumRoles([
      event("kick", 0, 3, { stripName: "BD 909" }),
      event("snare", TICKS_PER_BEAT, 11, { stripName: "Snare Strip" }),
      event("closed-hat", TICKS_PER_BEAT / 2, 23, { padName: "CHH" }),
      event("open-hat", TICKS_PER_BEAT * 1.5, 24, { padName: "OH" }),
    ]);

    expect(roleById(detected, "kick")).toBe("kick");
    expect(roleById(detected, "snare")).toBe("snare");
    expect(roleById(detected, "closed-hat")).toBe("closed_hat");
    expect(roleById(detected, "open-hat")).toBe("open_hat");
  });

  it("handles punctuation and camel-cased Audiotool lane names", () => {
    const detected = detectDrumRoles([
      event("kick", 0, 5, { padName: "BassDrum" }),
      event("snare", TICKS_PER_BEAT, 6, { padName: "snare_drum" }),
      event("closed-hat", TICKS_PER_BEAT / 2, 7, { padName: "closed-hihat" }),
      event("open-hat", TICKS_PER_BEAT * 1.5, 8, { padName: "openHihat" }),
    ]);

    expect(roleById(detected, "kick")).toBe("kick");
    expect(roleById(detected, "snare")).toBe("snare");
    expect(roleById(detected, "closed-hat")).toBe("closed_hat");
    expect(roleById(detected, "open-hat")).toBe("open_hat");
  });

  it("lets per-note lane names beat broad device names", () => {
    const detected = detectDrumRoles([
      event("snare", TICKS_PER_BEAT, 10, {
        deviceName: "808 drum machine",
        padName: "Snaredrum",
      }),
      event("hat", TICKS_PER_BEAT / 2, 12, {
        deviceName: "808 drum machine",
        padName: "Closed Hihat",
      }),
    ]);

    expect(roleById(detected, "snare")).toBe("snare");
    expect(roleById(detected, "hat")).toBe("closed_hat");
  });

  it("infers drum-machine hats, snares, and kicks from lane behavior when labels are missing or wrong", () => {
    const events: DrumEvent[] = [];
    const barTicks = TICKS_PER_BEAT * 4;

    for (let bar = 0; bar < 2; bar += 1) {
      const barStart = bar * barTicks;

      for (let step = 0; step < 8; step += 1) {
        events.push(
          event(`hat-${bar}-${step}`, barStart + step * (TICKS_PER_BEAT / 2), 73, {
            padName: "Cymbal",
          }),
        );
      }

      events.push(
        event(`kick-${bar}-1`, barStart, 60, { padName: "Low Tom" }),
        event(`kick-${bar}-3`, barStart + TICKS_PER_BEAT * 2, 60, { padName: "Low Tom" }),
        event(`snare-${bar}-2`, barStart + TICKS_PER_BEAT, 67, { padName: "Mid Tom" }),
        event(`snare-${bar}-4`, barStart + TICKS_PER_BEAT * 3, 67, { padName: "Mid Tom" }),
      );
    }

    const detected = detectDrumRoles(events);

    expect(rolesByPrefix(detected, "hat")).toEqual(new Set(["closed_hat"]));
    expect(rolesByPrefix(detected, "snare")).toEqual(new Set(["snare"]));
    expect(rolesByPrefix(detected, "kick")).toEqual(new Set(["kick"]));
  });
});

function event(
  id: string,
  time: number,
  pitch: number,
  context: Partial<
    Pick<DrumEvent, "deviceName" | "padName" | "regionName" | "stripName" | "trackName">
  > = {},
): DrumEvent {
  return {
    id,
    time,
    pitch,
    velocity: 0.7,
    role: "unknown",
    confidence: 0,
    ...context,
  };
}

function rolesByPrefix(events: DrumEvent[], prefix: string) {
  return new Set(
    events
      .filter((candidate) => candidate.id.startsWith(prefix))
      .map((candidate) => candidate.role),
  );
}

function roleById(events: DrumEvent[], id: string) {
  const event = events.find((candidate) => candidate.id === id);
  if (!event) {
    throw new Error(`No event with id ${id}`);
  }
  return event.role;
}
