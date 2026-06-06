# GrooveLab

GrooveLab is an Audiotool drum humanizer. The current framework is **Dilla-fy**:

- Detects kicks, snares/claps, and hats from GM pitch, names, and timing profiles.
- Infers whether hats are mostly 4th, 8th, or 16th note subdivisions.
- Lets you focus the preview/write pass on one Audiotool drum region.
- Drags hats late, adds extra offbeat hat swing, and shapes velocity accents by subdivision.
- Pulls snares slightly forward and lifts beat 4 over beat 2 when both backbeats exist.
- Shapes close kick pairs so downbeats, or the first offbeat, speak a little louder.
- Lets the strength control overdrive the framework up to 200% for exaggerated results.
- Writes timing and velocity changes back to Audiotool `note` entities.

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

6. Paste an Audiotool beta studio project URL and open it.

7. Choose a drum region or **All regions**, choose **Dilla-fy**, set the strength, preview the changes, then click **Write Groove**.

The default Dilla-fy strength is intentionally dramatic at 140%. Pull it back for subtlety, or push it to 200% when you want the timing and velocity changes to be extreme.

The write path updates existing notes from the loaded pattern state and current region selection. Rerolls preview from that loaded state so repeated writes do not keep pushing notes farther unless you reload the project after writing.

## Project Layout

- `src/nexus/audiotoolClient.ts`: Nexus auth, project open, note extraction, and transformed note write-back.
- `src/engine/humanizerEngine.ts`: Framework engine and Dilla-fy timing/velocity rules.
- `src/engine/roleDetection.ts`: MIDI/name/rhythm-based role classification.
- `src/data/humanizerFrameworks.ts`: Humanizer framework definitions.
- `src/components/GrooveVisualizer.tsx`: Before/after timing and velocity view.
- `src/App.tsx`: Audiotool control surface.

## Notes

The current implementation assumes 4/4 drum patterns. Unknown percussion and non-drum notes are left unchanged.
