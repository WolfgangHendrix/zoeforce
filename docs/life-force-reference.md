# Life Force NES campaign reference

This is the implementation contract for the six-stage campaign. It reconciles
the supplied US manual with the supplied WalkerBoh walkthrough and the more
detailed NES stage descriptions. When sources conflict, observed boss behavior
and the detailed stage description take precedence over a misplaced name in a
short walkthrough.

| Stage | Orientation | Zone | Defining sequence | Boss |
| --- | --- | --- | --- | --- |
| 1 | Horizontal | Cell Stage 1 | 12 five-ship power rows; tissue corridor; cells, webbing and death hands | Golem |
| 2 | Vertical | Volcanic Stage | 11 squads; volcanoes, split islands, rock storm, blast-through dirt, three-core fortress | Cruiser Tetran |
| 3 | Horizontal | Prominence Stage | 6 five-Phoenix power flocks; lava above/below; alternating and continuous flame arcs; red dragons | Intruder |
| 4 | Vertical | Cell Stage 2 | corpuscles; fast capillaries; erupting lung sacs; webbing; nodules; rib lasers and splitting rib tips | Giga |
| 5 | Horizontal | Temple Stage | 10 paired three-ship power waves; exterior hills/rocks/hatches; three-core miniboss; temple pillars and destructible block maze | Tutanhamanattack |
| 6 | Vertical | Mechanical City | alternating blue/gold squads; crystal bombs; cannons; crossing cylinders; Moai fortress | Zelos Force |

Campaign rules retained throughout:

- Death does not stop stage scrolling and the replacement ship returns in the
  same run.
- Options become recoverable green pickups on death.
- Horizontal and vertical stages alternate.
- Pre-stage squadrons are deterministic complete-set power-up opportunities.
- Bosses have specific weak points rather than generic full-body damage.
- Zelos requires both the circling dragon/soul and the heart to be destroyed,
  followed by a high-speed barrier escape and ending.

## Environmental pacing reconciliation

The later-stage pass treats an enemy-free interval as an environmental beat,
not empty travel. Prominence now alternates its large eruptions with short
counter-jets; Cellular Current keeps web and rib pressure through the Giga
approach; and Mechanical City uses shutters at both major section changes.

The largest reconciliation is the Temple interior after the three-core
checkpoint. It now alternates four complete masonry seals—each requiring the
player to shoot out a ship-sized route—with six pre-breached high/low walls.
Moving pillars, hatch guns and destructible blocks occupy the spaces between
those walls. This implements the guide's “temple pillars and destructible
block maze” as a sustained post-miniboss sequence rather than isolated small
enemies spread across otherwise empty scrolling.

Sources:

- US instruction manual: https://www.thegameisafootarcade.com/wp-content/uploads/2017/02/Life-Force-Salamander-Game-Manual.pdf
- Supplied walkthrough: https://gamefaqs.gamespot.com/nes/587413-life-force/faqs/11830
- Detailed NES stage guide: https://strategywiki.org/wiki/Life_Force/Walkthrough
