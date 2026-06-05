# GrooveLab

GrooveLab is currently a first-pass Audiotool MIDI velocity humanizer. It gives you:

- A Vite + React + TypeScript app wired for `@audiotool/nexus`.
- Audiotool OAuth boilerplate using the required `http://127.0.0.1:5173/` redirect.
- A basic note reader for Audiotool `note` entities.
- A MIDI-style velocity threshold, for example `+/-10`.
- A deterministic reroll button so you can preview another random humanization pass.
- A before/after velocity visualizer and write-back adapter for Nexus note entities.
- A demo pattern so the UI and groove logic work before Audiotool credentials are added.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Register an Audiotool application at `https://developer.audiotool.com/applications`.

   Use:

   - Redirect URI: `http://127.0.0.1:5173/`
   - Scope: `project:write`

3. Create `.env.local`:

   ```sh
   cp .env.example .env.local
   ```

   Then set:

   ```sh
   VITE_AUDIOTOOL_CLIENT_ID=your-client-id
   ```

   The client ID is not a secret. It is safe for browser code.

4. Start the app:

   ```sh
   npm run dev
   ```

5. Open `http://127.0.0.1:5173/`. The app checks Audiotool auth on load.

   - If you are not logged in, the first screen is a single Audiotool login button.
   - If you are already logged in, the login screen is skipped.
   - After login, the next screen asks for an Audiotool project URL.

6. Paste an Audiotool project URL from `https://beta.audiotool.com/studio?project=...` and open it.

   The last project URL is remembered in browser local storage so repeat sessions are prefilled.

7. Set the velocity range, preview the changes, then click **Write Velocities**.

The range uses MIDI velocity units from 0 to 127. A setting of `+/-10` means each note can move by up to 10 velocity units up or down. The app writes only the `velocity` field; timing, pitch, and duration are left unchanged.

## Project Layout

- `src/nexus/audiotoolClient.ts`: Nexus auth, project open, note extraction, and velocity write-back.
- `src/engine/velocityHumanizer.ts`: The first MVP humanizer.
- `src/engine/roleDetection.ts`: MIDI/name/rhythm-based role classification.
- `src/engine/grooveEngine.ts`: Advanced groove experiment kept aside for later.
- `src/data/groovePresets.ts`: Starting preset definitions.
- `src/components/VelocityVisualizer.tsx`: Before/after velocity view.
- `src/App.tsx`: Hackathon-ready control surface.

## Notes

The MVP write-back path updates existing Audiotool `note` entities only. Pattern-device-specific transforms such as `machinistePattern` can be added in the adapter after you inspect the exact project entities you want to target.
